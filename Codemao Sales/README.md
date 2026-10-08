# Codemao Sales

编程猫家长异议处理插件。普通异议先由 Codemao Sales Brain 子智能体判断可用的弹药库小节；有贴题卡时由话术卡 Skill 从成员自己的 DOCX 交付文字、语音、图片三件套，没有贴题卡时由大脑原创一版可发送回复。明确要求原创或重写时也由大脑处理。

## 安装

将本仓库克隆到一个长期保留的本机目录，运行该插件目录下的 `Install-CodemaoSales.ps1`，然后重新加载 Codex。安装脚本会注册本地 marketplace、安装插件，并把随包的具名 Agent 模板复制到个人 `~/.codex/agents/`。同名 Agent 若已存在且内容不同，脚本会停止，不覆盖原配置。

```powershell
git clone https://github.com/maaaaaa12138/Plugins.git
powershell -NoProfile -File ".\Plugins\Codemao Sales\Install-CodemaoSales.ps1"
```

也可以把仓库链接发给 Codex，并明确说：“请把这个仓库克隆到长期保留的本机目录，阅读并运行 `Codemao Sales/Install-CodemaoSales.ps1`，安装插件和具名 Agent。”仅发送链接或只在插件界面点安装，不会自动复制具名 Agent TOML。

## 个人弹药库

公开仓库不附带任何话术 DOCX。安装后向 Codex 提供自己的 DOCX，并说“用这份文档作为我的弹药库”；`codemao-orl-import` 会整理标题并放入本机插件原件目录的 `Objection Response Library/`。个人 DOCX 和导入后的备份目录已被 Git 忽略，不要提交个人文档。换弹药库时不需要改插件版本号。

### 图形化物料快捷方式

如果图片素材在自己电脑的其他文件夹，不需要复制进插件，也不要上传到 GitHub。请在自己的“图形化物料”文件夹上创建 Windows 快捷方式，把这个 `.lnk` 文件放进 `Objection Response Library/`。话术卡 Skill 会自动解析快捷方式并读取目标文件夹里的图片；每位同事可以放自己的快捷方式，目标路径可以不同。快捷方式失效时，出卡前会提示具体问题。只有 PNG、JPG、JPEG、WEBP、GIF、BMP 会作为图片素材，视频文件不会被误当成图片。

如果环境不支持具名子智能体，插件会使用默认子智能体执行相同角色规则。若某条异议在个人弹药库中没有贴题的原文卡，流程会说明缺卡，并交付标明“原创”的回复；不会把原创内容冒充文档原文。

## 可选知识库

有权限的成员可另行安装并配置 IMA Skill，让销售大脑在复杂策略、原创或复盘时按需读取相关原文。插件不附带 IMA 凭证，也不授予知识库访问权限；普通原文出卡仍只读该成员自己的 DOCX。

本公开版不包含个人弹药库和内部策略资料索引。原创话术中的课程与服务事实需由使用者自行核实。
