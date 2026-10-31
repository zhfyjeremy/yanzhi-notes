折叠摘要块基础形态:

<details>
<summary>基础形态</summary>

折叠内容第一段,后面跟列表。

- 列表项 A
- 列表项 B

</details>

<details open>
<summary>默认展开</summary>

展开态的正文。

</details>

<details>
<summary>特殊字符 &amp; &lt; 与 "引号"</summary>

实体转义后往返稳定。

</details>

<details>
<summary>空内容</summary>

</details>

嵌套时外层转换、内层保持原文:

<details>
<summary>外层</summary>

外层正文。

<details>
<summary>内层</summary>

内层正文。

</details>

</details>

未知属性保持原文:

<details class="x">
<summary>未知属性保持原文</summary>

内容。

</details>

引用内保持原文:

> <details>
> <summary>引用内保持原文</summary>
> </details>

未闭合保持原文:

<details>
<summary>未闭合不转换</summary>

内容保持原文。
