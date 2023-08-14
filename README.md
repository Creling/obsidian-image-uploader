# Obsidian Image Uploader

![](https://i.loli.net/2021/07/16/fxWBeLAESNc6tK9.gif)

This plugin could resize(optional) and upload the image in your clipboard to any image hosting automatically when pasting.

## Changelog
- 0.3.2
	- Add 'Upload All Local Images in This Page' command.
- 0.3.1
	- Fix some minor problems.
- 0.3.0
	- Support Obsidian Live Preview Editor.

## Getting started

### Settings

1. Api Endpoint: the Endpoint of the image hosting api.
2. Upload Header: the header of upload request in **json** format.
3. Upload Body: the body of upload request in **json** format. Don't change it unless you know what you are doing.
4. Image Url Path: the path to the image url in http response.
5. Enable Resize: whether resizing images before uploading.
6. Max Width: images that wider than this will be resized resized by the natural aspect ratio.

### Examples

#### Imgur

Take Imgur as an example. The upload request is something like this:

```shell
curl --location --request POST 'https://api.imgur.com/3/image' \
--header 'Authorization: Client-ID {{clientId}}' \
--form 'image="R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"'
```

So, `Api Endpoint` should be `https://api.imgur.com/3/image` and `Upload Header` should be `{"Authorization": "Client-ID {{clientId}}"}`.

The response of the upload request is:

```json
{
	"data": {
		"id": "orunSTu",
		"title": null,
		"description": null,
		"datetime": 1495556889,
		"type": "image/gif",
		"animated": false,
		"width": 1,
		"height": 1,
		"size": 42,
		"views": 0,
		"bandwidth": 0,
		"vote": null,
		"favorite": false,
		"nsfw": null,
		"section": null,
		"account_url": null,
		"account_id": 0,
		"is_ad": false,
		"in_most_viral": false,
		"tags": [],
		"ad_type": 0,
		"ad_url": "",
		"in_gallery": false,
		"deletehash": "x70po4w7BVvSUzZ",
		"name": "",
		"link": "http://i.imgur.com/orunSTu.gif"
	},
	"success": true,
	"status": 200
}
```

All you need is the image url `http://i.imgur.com/orunSTu.gif`, so `Image Url Path` should be `data.link`.

#### Lsky-Pro

[Lsky-Pro](https://github.com/lsky-org/lsky-pro) is a open-sourced and self-hosted image hosting solution.

Thanks to [@xaya1001](https://github.com/Creling/obsidian-image-uploader/issues/9#issuecomment-1562861494) for this example.

```
api endpoint：https://img.domain.com/api/v1/upload

upload header: 
{
  "Authorization": "Bearer xxxx",
  "Accept": "application/json",
  "Content-Type": "multipart/form-data"
}

upload body: 
{
  "file": "$FILE"
}

Image Url Path: data.links.url
```

## Thanks

1. [obsidian-imgur-plugin](https://github.com/gavvvr/obsidian-imgur-plugin)
2. [create-obsidian-plugin](https://www.npmjs.com/package/create-obsidian-plugin)
