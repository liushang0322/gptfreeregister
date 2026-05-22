# Mihomo GPT 支付/注册分流自动配置提示词

下面这段提示词用于交给用户自己电脑上的 AI 助手执行。目标是让 AI 自动检测本机正在使用的 mihomo / Clash Meta 配置，备份后修改当前配置，新增 GPT 支付和 GPT 注册专用分流。

> 使用方式：复制下面整段提示词，粘贴给你电脑上的 AI 助手。请确保 AI 有读取和修改本机文件的权限。

````text
请你作为本机 mihomo / Clash Meta 配置修改助手，自动检测当前电脑上的 mihomo、Clash Meta、Clash Verge、Clash Verge Rev、Mihomo Party、Clash Meta for Windows 等客户端正在使用的 YAML 配置文件，并在安全备份后修改当前生效配置。

任务目标：
在当前 mihomo 配置中新增或更新两个分流组：

1. GPT支付分流
   仅使用美国节点。

2. GPT注册分流
   仅使用日本节点，并使用轮询。

同时把指定域名规则插入到 rules: 最前面，优先级必须高于原配置中已有的 openai、paypal、stripe、AI 服务、支付平台等规则。

请严格按以下要求执行。

一、检测配置文件

1. 自动查找当前客户端正在使用的 mihomo YAML 配置文件。
2. 优先读取 GUI 客户端记录的当前启用配置路径。
3. 常见客户端包括但不限于：
   - Clash Verge / Clash Verge Rev
   - Mihomo Party
   - Clash Meta for Windows
   - 其他基于 mihomo 内核的客户端
4. 如果无法可靠判断当前启用配置，不要猜测和乱改，请停止并要求用户手动提供 YAML 配置路径。

二、修改前备份

1. 修改前必须在原配置同目录创建备份文件。
2. 备份文件名格式建议为：
   原文件名.backup-YYYYMMDD-HHMMSS.yaml
3. 不要删除用户原有节点、订阅、代理组、规则、注释和其他配置。
4. 不要修改 proxy-providers 中的订阅 URL、token、path、interval 等字段。
5. 不要修改 proxies 中已有节点内容。

三、解析和写回 YAML

1. 读取并解析 YAML，尽量保留原有结构。
2. 如果已有同名代理组 GPT支付分流 或 GPT注册分流，请更新它们，不要重复添加。
3. 如果已有相同域名规则，请移动或更新到 rules: 最前面，不要重复添加。
4. 写回后必须重新解析 YAML，确认语法有效。
5. 如果使用脚本修改，请优先使用成熟 YAML 库，避免用简单字符串替换破坏配置。

四、新增或更新代理组

请在 proxy-groups: 中新增或更新以下两个代理组。

GPT支付分流：

- 该组只能匹配美国节点。
- 支付场景更看重稳定性，推荐使用 url-test 或 select，不推荐频繁换 IP。
- 如果原配置明显偏好 load-balance，也可以保留用户风格，但不要让支付请求在短时间内频繁漂移。
- 节点匹配关键词建议：
  美国、美國、United States、USA、US、America、洛杉矶、圣何塞、西雅图、纽约、🇺🇸
- 必须排除流量、套餐、到期、提示类伪节点。

推荐配置：

```yaml
- name: "GPT支付分流"
  type: url-test
  include-all: true
  include-all-proxies: true
  include-all-providers: true
  filter: '(?i)(美国|美國|united states|usa|\bus\b|america|洛杉矶|圣何塞|西雅图|纽约|🇺🇸)'
  exclude-filter: '(?i)(剩余流量|距离下次重置|下次重置剩余|重置剩余|套餐到期|到期时间|流量重置|traffic|expire|expiration|subscription|subscribe|reset|plan|建议)'
  url: "https://www.gstatic.com/generate_204"
  interval: 300
  lazy: false
  expected-status: 204
```

GPT注册分流：

- 该组只能匹配日本节点。
- 必须使用轮询。
- 节点匹配关键词建议：
  日本、东京、大阪、Japan、Tokyo、JP、🇯🇵
- 必须排除流量、套餐、到期、提示类伪节点。

推荐配置：

```yaml
- name: "GPT注册分流"
  type: load-balance
  strategy: round-robin
  include-all: true
  include-all-proxies: true
  include-all-providers: true
  filter: '(?i)(日本|东京|大阪|japan|tokyo|\bjp\b|🇯🇵)'
  exclude-filter: '(?i)(剩余流量|距离下次重置|下次重置剩余|重置剩余|套餐到期|到期时间|流量重置|traffic|expire|expiration|subscription|subscribe|reset|plan|建议)'
  url: "https://www.gstatic.com/generate_204"
  interval: 300
  lazy: false
  expected-status: 204
```

五、插入 rules 规则

请把以下规则插入到 rules: 数组最前面，并保证顺序完全如下。

注意：因为 DOMAIN-SUFFIX,openai.com 会匹配 pay.openai.com，所以 pay.openai.com 必须放在 openai.com 之前。

```yaml
- DOMAIN-SUFFIX,paypal.com,GPT支付分流
- DOMAIN,www.paypal.com,GPT支付分流
- DOMAIN-SUFFIX,recaptcha.net,GPT支付分流
- DOMAIN-SUFFIX,midtrans.com,GPT支付分流
- DOMAIN,checkout.stripe.com,GPT支付分流
- DOMAIN,pay.openai.com,GPT支付分流
- DOMAIN-SUFFIX,chatgpt.com,GPT注册分流
- DOMAIN-SUFFIX,openai.com,GPT注册分流
- DOMAIN,auth.openai.com,GPT注册分流
```

六、规则含义

以下域名必须走 GPT支付分流，即美国节点：

- *.paypal.com
- www.paypal.com
- *.recaptcha.net
- *.midtrans.com
- checkout.stripe.com
- pay.openai.com

以下域名必须走 GPT注册分流，即日本节点轮询：

- chatgpt.com
- openai.com
- auth.openai.com

七、兼容性要求

1. 如果当前配置的 proxy-groups 支持 include-all、include-all-proxies、include-all-providers、filter、exclude-filter，请优先用上述自动筛选写法。
2. 如果当前客户端或配置不支持 include-all/filter 写法，请退化为手动收集当前配置中名称包含美国关键词的节点，写入 GPT支付分流 的 proxies 列表；手动收集名称包含日本关键词的节点，写入 GPT注册分流 的 proxies 列表。
3. 如果找不到任何美国节点或日本节点，请不要写入无效配置，请明确提示用户缺少对应地区节点。
4. 如果原配置里已有类似“日本轮询”“美国自动选择”“支付平台”“AI 服务”等组，不要直接复用，除非能保证只包含目标国家节点。更推荐创建本次指定的两个独立组。

八、完成后输出报告

修改完成后请输出：

1. 检测到并修改的配置文件路径。
2. 备份文件路径。
3. 新增或更新的代理组名称。
4. 插入或移动到 rules: 最前面的规则列表。
5. YAML 语法校验结果。
6. 是否尝试热重载 mihomo 配置。
7. 如果无法热重载，请提示用户在客户端中手动重载配置。

九、安全边界

1. 不要上传用户配置文件。
2. 不要打印订阅 token、节点密码、uuid、private key 等敏感内容。
3. 不要删除原配置。
4. 不要清空 rules、proxies、proxy-groups、proxy-providers。
5. 不要为了“整理配置”重写整个文件，只做本任务需要的最小修改。
````
