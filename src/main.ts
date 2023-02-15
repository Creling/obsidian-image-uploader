import {
  Notice,
  Plugin,
  Editor,
  MarkdownView,
  EditorPosition,
  Menu,
  FileSystemAdapter,
  addIcon
} from "obsidian";

import axios from "axios";
import objectPath from 'object-path';
import ImageUploaderSettingTab from './settings-tab';
import Compressor from 'compressorjs';

import {
  PasteEventCopy,
} from './custom-events';

interface ImageUploaderSettings {
  apiEndpoint: string;
  uploadHeader: string;
  uploadBody: string;
  imageUrlPath: string;
  maxWidth: number;
  enableResize: boolean;
}

import { existsSync, readFileSync } from 'fs';
import { basename, extname } from 'path';

const DEFAULT_SETTINGS: ImageUploaderSettings = {
  apiEndpoint: null,
  uploadHeader: null,
  uploadBody: "{\"image\": \"$FILE\"}",
  imageUrlPath: null,
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
    if (ev.clipboardData.files.length==0) {
      console.log("no file is pasted")
      return
    }

    let file = ev.clipboardData.files[0];
    const imageType = /image.*/;
    if (file.type.match(imageType)) {

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

      // upload the image
      try{
        const url = await this.uploadImage(editor,file,file.name)
        const imgMarkdownText = `![](${url})`
        this.replaceText(editor, pastePlaceText, imgMarkdownText)
      }catch(e){
        new Notice('[Image Uploader] Upload unsuccessfully, fall back to default paste!', 5000)
        this.replaceText(editor,pastePlaceText,'')
        console.log(mkView.currentMode)
        mkView.currentMode.clipboardManager.handlePaste(
          new PasteEventCopy(ev)
        );
      }
    }
  }

  menuHandler(menu:Menu,editor:Editor):void{
    if(editor.somethingSelected()){
      const start = editor.getCursor("from").line;
      const end = editor.getCursor('to').line;
      menu.addItem((item)=>{
        item
          .setTitle('Upload Image in Selection')
          .setIcon('upload1')
          .onClick(()=>{
            this.getImageAndUpload(editor,start,end)
          })
      });
    }else{
      menu.addItem((item)=>{
        item
          .setTitle('Upload Image in File')
          .setIcon('upload1')
          .onClick(()=>{
            this.getImageAndUpload(editor,0,editor.lastLine())
          })
      })
    }
  }

  async getImageAndUpload(editor:Editor,start,end): Promise<void>{
    let success: number = 0, fail: number = 0, ignore: number = 0;
    let upload_cache: Map<string,string>= new Map();
    const file_path = this.app.workspace.getActiveFile().path;
    const file_cache = this.app.metadataCache;
    const root_path = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    const REGEX_LINK = /\!\[([^\[]*?|[^\]]*?)\]\((.*?)\)/g;
    const REGEX_WIKI_LINK = /\!\[\[(.*?)\s*(\|\s*(.*?)\s*)?\]\]/g;
    
    for(let i:number=start; i<=end; i++){
      let value = editor.getLine(i);
      const all_matches = [...value.matchAll(REGEX_LINK)].concat([...value.matchAll(REGEX_WIKI_LINK)])

      for(const link of all_matches){
        let tag: string, path: string, wiki_mode: boolean, ext: string, name: string, url: string, upload_path: string
        if(link.length == 3){
          tag = link[1] || '';
          path = decodeURI(link[2]);
          wiki_mode = false;  //standard markdown link: ![]()
        }else if(link.length == 4){
          tag = link[3] || '';
          path = link[1];
          wiki_mode = true;  //wiki link: ![[]]
        }else {
          ignore++
          continue;
        }

        const source = link[0];  //the full link text
        const idx = editor.getLine(i).indexOf(source);
        const from = {line: i,ch: idx} as EditorPosition;
        const to = {line: i,ch: idx + source.length} as EditorPosition;

        //if path is cached，just read from cache, no need to upload
        if(upload_cache.has(path)){
          //直接替换缓存
          url = upload_cache.get(path)
          editor.replaceRange(`![${tag}](${url})`, from, to);
          success++;
          continue;
        }

        //check if path is web link
        if(path.startsWith('http')){
          console.log('ignore web image: ' + path);
          ignore++;
          continue;
        }

        //check if path can be accessed. check both internal and external path 
        const tfile = file_cache.getFirstLinkpathDest(path,file_path)
        if(!tfile){
          if(!wiki_mode && existsSync(path)){
            ext = extname(path)
            name = basename(path)
            upload_path = path
          }else{
            console.log('bad link: ' + path)
            ignore++;
            continue;
          }
        }else{
          ext = `.${tfile.extension}`
          name = `${tfile.basename}${ext}`    
          upload_path = `${root_path}/${tfile.path}`
        }
        
        //check if the file is image file
        if(!this.isImageFile(ext)){
          console.log('not a image: ' + path)
          ignore++;
          continue;
        }

        //upload the image
        try{
          const blob = new Blob([readFileSync(upload_path)]);
          url = await this.uploadImage(editor, blob, `${name}`);
          editor.replaceRange(`![${tag}](${url})`, from, to);
          upload_cache.set(path,url);
          success++;
        }catch(e){
          console.log(e)
          fail++;
        }
      }
    }
    // clear selection
    editor.setCursor(editor.getCursor('head'));
    new Notice(`[Image Uploader] Upload Results:\n${success} successed\n${fail} failed\n${ignore} ignored`, 5000)
  }

  isImageFile(ext: string): boolean {
    return ['.png','.jpg','.jpeg','.bmp','.gif','.svg','.tiff','.webp'].includes(ext.toLowerCase())
  }

  uploadImage(editor: Editor, file: File | Blob, filename: string): Promise<string>{
    const formData = new FormData()
    const uploadBody = JSON.parse(this.settings.uploadBody)

    for (const key in uploadBody) {
      if (uploadBody[key] == "$FILE") {
        formData.append(key, file, filename)
      }
      else {
        formData.append(key, uploadBody[key])
      }
    }
    return new Promise((resolve,reject)=>{
      axios.post(this.settings.apiEndpoint, formData, {
        "headers": JSON.parse(this.settings.uploadHeader)
      }).then(res => {
        const url = objectPath.get(res.data, this.settings.imageUrlPath)
        resolve(url);
      }, err => {
        reject(err);
      })
    })
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    // this.setupPasteHandler()
    this.addSettingTab(new ImageUploaderSettingTab(this.app, this));

    this.pasteFunction = this.pasteHandler.bind(this);
    this.menuFunction = this.menuHandler.bind(this);

    this.registerEvent(
      this.app.workspace.on('editor-paste', this.pasteFunction)
    );
    this.registerEvent(
      this.app.workspace.on('editor-menu',this.menuFunction)
    );

    addIcon(
      'upload1',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path fill="currentColor" d="M3 19h18v2H3v-2zm10-9v8h-2v-8H4l8-8 8 8h-7z"/>
  </svg>`
    )
    console.log("loading Image Uploader");
  }

  onunload(): void {
    this.app.workspace.off('editor-paste', this.pasteFunction);
    this.app.workspace.off('editor-menu', this.menuFunction);
    console.log("unloading Image Uploader");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
