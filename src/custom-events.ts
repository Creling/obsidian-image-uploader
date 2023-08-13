/*
 * @Author: Creling
 * @Date: 2022-08-26 09:52:01
 * @LastEditors: Creling
 * @LastEditTime: 2022-08-26 09:52:45
 * @Description: file content
 */

export class PasteEventCopy extends ClipboardEvent {
  constructor(originalEvent: ClipboardEvent) {
    const clipboardData = originalEvent?.clipboardData;
    if (!clipboardData) {
      super("paste");
      return;
    }

    const { files } = clipboardData;
    const dt = new DataTransfer();
    for (let i = 0; i < files.length; i += 1) {
      dt.items.add(files.item(i)!);
    }
    super("paste", { clipboardData: dt });
  }
}