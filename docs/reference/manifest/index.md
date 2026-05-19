---
title: "Mainfest(mainfest)"
description: "应用 manifest.yml 配置说明。"
order: 65536
path: "manifest"
---
<!-- wikiSync: id=6a0acf9ebde76b2c4f035047 locale=zh-cn route=reference/manifest (merged index) -->
## Manifest

`manifest.yml` 描述应用模块、扩展点与权限。

```yaml
app:
  version: 1.0.0
modules:
  - key: example-module
    target: pcm:pjm:project:page
```
