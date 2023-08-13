import {
  Notice,
  Plugin,
  Editor,
  MarkdownView,
  EditorPosition,
  normalizePath,
} from "obsidian";

import axios from "axios";
import objectPath from 'object-path';
import ImageUploaderSettingTab from './settings-tab';
import Compressor from 'compressorjs';

import {
  PasteEventCopy,
} from './custom-events';
import { resolve } from "path";


// Avoid the error: Property 'clipboardManager' does not exist on type 'MarkdownSubView'
declare module 'obsidian' {
  interface MarkdownSubView {
    clipboardManager: ClipboardManager
  }
}

interface ClipboardManager {
  handlePaste(e: ClipboardEvent): void
  handleDrop(e: DragEvent): void
}

interface ImageUploaderSettings {
  apiEndpoint: string;
  uploadHeader: string;
  uploadBody: string;
  imageUrlPath: string;
  maxWidth: number;
  enableResize: boolean;
}

const DEFAULT_SETTINGS: ImageUploaderSettings = {
  apiEndpoint: "",
  uploadHeader: "",
  uploadBody: "{\"image\": \"$FILE\"}",
  imageUrlPath: "",
  maxWidth: 4096,
  enableResize: false,
};

interface pasteFunction {
  (this: HTMLElement, event: ClipboardEvent): void;
}

export default class ImageUploader extends Plugin {
  settings: ImageUploaderSettings;
  pasteFunction: pasteFunction;

  private replaceText(editor: Editor, target: string, replacement: string): void {
    target = target.trim()
    const lines = editor.getValue().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ch = lines[i].indexOf(target)
      if (ch !== -1) {
        const from = { line: i, ch: ch } as EditorPosition;
        const to = { line: i, ch: ch + target.length } as EditorPosition;
        editor.setCursor(from);
        editor.replaceRange(replacement, from, to);
        break;
      }
    }
  }

  async pasteHandler(ev: ClipboardEvent, editor: Editor, mkView: MarkdownView): Promise<void> {
    if (ev.defaultPrevented) {
      console.log("paste event is canceled");
      return;
    }

    let clipboardData = ev.clipboardData?.files[0];
    const imageType = /image.*/;
    if (clipboardData && clipboardData.type.match(imageType)) {
      let file: File = clipboardData!;
      ev.preventDefault();

      // set the placeholder text
      const randomString = (Math.random() * 10086).toString(36).substring(0, 8);
      const pastePlaceText = `![uploading...](${randomString})\n`
      editor.replaceSelection(pastePlaceText)

      // resize the image
      if (this.settings.enableResize) {
        const maxWidth = this.settings.maxWidth
        const compressedFile = await new Promise((resolve, reject) => {
          new Compressor(file, {
            maxWidth: maxWidth,
            success: resolve,
            error: reject,
          })
        })
        file = compressedFile as File
      }

      this.uploadImage(file).then(url => {
        const imgMarkdownText = `![](${url})`
        this.replaceText(editor, pastePlaceText, imgMarkdownText)
      }, err => {
        new Notice('[Image Uploader] Upload unsuccessfully, fall back to default paste!', 5000)
        console.log(err)
        this.replaceText(editor, pastePlaceText, "");
        mkView.currentMode.clipboardManager.handlePaste(
          new PasteEventCopy(ev)
        );
      })
    }
  }

  async uploadImage(image: File): Promise<string> {

    return new Promise((resolve, reject) => {
      const formData = new FormData()
      const uploadBody = JSON.parse(this.settings.uploadBody)

      for (const key in uploadBody) {
        if (uploadBody[key] == "$FILE") {
          formData.append(key, image, image.name)
        }
        else {
          formData.append(key, uploadBody[key])
        }
      }

      axios.post(this.settings.apiEndpoint, formData, {
        "headers": JSON.parse(this.settings.uploadHeader)
      }).then(res => {
        const url = objectPath.get(res.data, this.settings.imageUrlPath)
        resolve(url)
      }, err => {
        reject(err)
      })
    })
  }

  async uploadLocalImages(): Promise<void> {
    // Get the current active MarkdownView
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) return;
    // Get Editor
    const editor = markdownView.editor;
    // Get all the text
    const lines = editor.getValue().split("\n");

    const allFiles = this.app.vault.getFiles();

    let imageNameAndLinks: { [key: string]: string }[] = [];
    let imageNames: string[] = [];

    for (let line of lines) {
      // Match ![[...<Image Name>.<ext>]] or ![](...<Image Name>.<ext>)
      const imageLinks = line.match(/(!\[\[.+\]\])|(!\[.+\(.+\))/gm);
      if (!imageLinks) continue;

      for (const imageLink of imageLinks) {

        // Match ...<Image Name>.<ext>
        let imageInfo = imageLink.match(/(?:\[\[|!\[]\()(?<uri>.*?)(?:\)|\]\])/);
        if (!imageInfo) continue;

        let imageURI = imageInfo?.groups?.uri!;

        if (imageURI.startsWith("http")) continue

        // Get <Image Name>.<ext>
        const imageName = decodeURIComponent(imageURI.split("/").pop()!);
        imageNameAndLinks.push({ [imageName]: imageLink });
        imageNames.push(imageName);
      }

      const targetImages = allFiles.filter(file => {
        return imageNames.includes(file.name);
      });

      for (const targetImage of targetImages) {
        const data = await this.app.vault.adapter.readBinary(normalizePath(targetImage.path));
        const blob = new Blob([data]);
        const file = new File([blob], targetImage.name, { type: 'image/png' });

        this.uploadImage(file).then(url => {
          const imgMarkdownText = `![](${url})`
          const imageNameAndLink = imageNameAndLinks.find((item: { [key: string]: string }) => {
            return Object.keys(item)[0] === targetImage.name;
          });
          if (imageNameAndLink) {
            const imageLink = imageNameAndLink[targetImage.name];
            this.replaceText(editor, imageLink, imgMarkdownText);
          }
        }, err => {
          new Notice('[Image Uploader] Upload unsuccessfully', 5000)
          console.log(err)
        })
      }


      // const data = await this.app.vault.adapter.readBinary(imagePath);
      // const blob = new Blob([data]);
      // const file = new File([blob], imageName, { type: 'image/png' });

      // this.uploadImage(file).then(url => {
      //   const imgMarkdownText = `![](${url})`
      //   this.replaceText(editor, imageLink, imgMarkdownText)
      // }, err => {
      //   new Notice('[Image Uploader] Upload unsuccessfully, fall back to default paste!', 5000)
      //   console.log(err)

      // })

    }
  }

  async onload(): Promise<void> {
    console.log("loading Image Uploader");
    await this.loadSettings();
    // this.setupPasteHandler()
    this.addSettingTab(new ImageUploaderSettingTab(this.app, this));

    this.pasteFunction = this.pasteHandler.bind(this);

    this.registerEvent(
      this.app.workspace.on('editor-paste', this.pasteFunction)
    );

    this.addCommand({
      id: 'upload-all-local-images',
      name: 'Upload All Local Images in This Page',
      callback: this.uploadLocalImages.bind(this),
    });
  }

  onunload(): void {
    this.app.workspace.off('editor-paste', this.pasteFunction);
    console.log("unloading Image Uploader");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
