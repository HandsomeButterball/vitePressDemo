---
title: "开始使用Nexus"
description: "在快速入门下的子页面（mock）。"
order: 65536
path: "guide"
---

<!-- wikiSync: id=6a05647d10ea51b8943a3ca3 locale=zh-cn route=user-manual/getting-started/guide -->
欢迎使用   **PingCode Nexus**   云应用开发平台，本指南将带你从零开始配置 Nexus 环境，并亲手创建一个   **Hello World**   应用。



## 🛠️ 准备工作

在开始之前，你需要做这些准备工作：

- **技术栈**
    - Nexus 应用基于 TypeScript 编写，因此你需要熟悉 TypeScript，熟悉 Angular 也会对 Nexus 开发有所帮助
- **Node 环境**
    - Node.js 24.x (LTS)
    - 使用  * *  `node -v`  进行版本验证
- **注册开发者账号**
    - 访问   [PingCode 开发者中心](https://developer.alpha.pingcode.live/signup)   完成开发者注册




## 💻 安装与配置 CLI

**Nexus CLI**   是你与 PingCode 开发者中心交互的核心工具，支持应用创建、部署和安装。

### 全局安装 CLI

打开终端，执行以下命令：

```
npm install -g @pc-nexus/cli@latest
```

### 验证安装

确保命令已正确安装到系统路径：

```
nexus --version
```

> 💡   **提示**  ：如果无法识别命令，请检查 npm 环境变量配置。你可以运行   `nexus --help`   查看所有可用指令。



## 🔑 身份验证与登录

为了让 CLI 获得操作权限，你需要在开发者中心创建   **个人访问令牌 (Personal Access Token)**  。

### 创建   **Personal Access Token**

1. 进入   [PingCode 开发者中心 - 访问令牌](https://developer.alpha.pingcode.live/settings/personal-access-tokens)
1. 点击右上角   **[新建]**   按钮
1. 输入名称（如：  `nexus-token`  ），选择过期时间并确定
1. 立即复制并保存生成的 Token  **（关闭弹窗后将无法再次查看）**


### 执行登录

在终端输入以下命令，并根据提示输入手机号和 Token：

```
nexus login
```

```
┌  Log in to your PingCode Developer account
│
◇  Enter your phone number:
│  18800000000
│
◇  Enter your PingCode API token:
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪
│
◇  Logged in as 18800000000.
│
└  Now try running 'nexus create' to start a new app.
```



## 🏗️ 创建你的第一个 Nexus  应用

### 初始化项目

进入你的工作目录，执行 create 命令，选择   `pjm-project-page`   模板创建应用

```
nexus create hello-world-app
```

切换到应用查看目录结构

```
// cd hello-world-app

hello-world-app
├── src/
│   ├── handlers/
│   │   └── index.ts
│   ├── resolvers/
│   │   └── index.ts
│   └── index.ts
├── web/
│   └── hello-world/
│       ├── src/
│       │   ├── app/
│       │   │   ├── app.config.ts
│       │   │   ├── app.html
│       │   │   ├── app.routes.ts
│       │   │   ├── app.scss
│       │   │   └── app.ts
│       │   ├── index.html
│       │   ├── main.ts
│       │   └── styles.scss
│       ├── angular.json
│       ├── package.json
│       ├── tsconfig.app.json
│       ├── tsconfig.json
│       └── tsconfig.spec.json
├── manifest.yaml
├── package.json
└── tsconfig.json
```

-   `src/`  后端/运行时逻辑源码目录
-   `web/`  前端资源目录，默认包含一个示例 Web 应用，构建后产物用于作为模块资源被加载
-   `manifest.json`   Nexus APP 配置文件，定义应用的功能模块、权限及展示位置




## 更改应用标题

这个应用使用的   `pcm:pjm:project:page`   扩展点，这个扩展点用于在 Project 详情页扩展一级菜单页面，让我们将这个页面改为自定义名称。

1. 在应用的顶层目录打开   `manifest.yml`   文件
1. 在   `modules`  下找到   `pcm:pjm:project:page`  扩展点配置
1. 修改扩展点配置中的   `title`  属性为   `New Title`


更新后的   `manifest.yml`   文件应如下所示，其中包含您的标题和应用程序 ID 的值

```
app:
  version: 1.0.0
  id: e481d841-e3dc-4b4d-907a-7d7954acee57
modules:
  - key: hello-world-project-page
    resource: main
    target: pcm:pjm:project:page
    resolver:
      function: resolver
    title: New Title
functions:
  - key: resolver
    handler: index.handler
resources:
  - key: main
    path: web/hello-world/dist
permissions:
  scopes:
    - pcp:app:storage
    - pcp:read:app-system-token
    - pcp:read:app-user-token
    - pcp:read:pcp:pjm:workitem
    - pcp:write:pcp:pjm:workitem

```



## 🚀 部署与安装

应用创建后，需要将其上传到云端并分发到你的 PingCode 站点进行安装。

### 构建代码

首先需要先构建你的前端代码

```
npm run build-web
```

### 部署代码

执行   `deploy`   选择   `Development`   环境，将本地代码编译并上传至 PingCode 云平台。

```
nexus deploy
```

### 分发应用

执行   `distribute`  ，输入你的 PingCode 站点 Site Url，选择   `Development`   环境，将应用分发到你的站点。

```
nexus distribute
```

### 安装应用

打开你的 PingCode 站点，进入 [后台管理] -->[应用]-> [应用审核]，在列表选择你的应用点击安装。

### 验证效果

安装成功后，打开你的 PingCode 团队站点，找到应用对应的扩展点，即可看到你创建   **Hello World**   页面。

### 应用更新

当你修改了   `src/`   下的代码后，只需再次运行   `nexus deploy`  ，选择   **与上次相同的开发环境 **  即可同步更改。



**🚀 恭喜你完成了第一个 Nexus 应用的搭建！**
