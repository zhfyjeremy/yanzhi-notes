import { createRoot } from "react-dom/client";
import { createElement } from "react";
import "../../index.css";
import { YanzhiEditor } from "../YanzhiEditor";

const markdown = `<p align="center">
  <img width="160" src="./src/static/logo.svg">
</p>

<h1 align="center">许昌烟草 · 移动端管理后台</h1>

<div align="center">

![node version](https://img.shields.io/badge/node-%3E%3D20-green)
![pnpm version](https://img.shields.io/badge/pnpm-%3E%3D9-green)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---
`;
createRoot(document.getElementById("root")!).render(
  createElement("div", { style: { width: 820, margin: "24px auto" } },
    createElement(YanzhiEditor, { markdown, showToolbar: false })
  )
);setTimeout(() => {
  const data = [...document.querySelectorAll<HTMLElement>(".yz-raw-html")].map((el, i) => {
    const shell = el.querySelector<HTMLElement>(".yz-raw-html-preview")!;
    const frame = el.querySelector("iframe")!;
    const doc = frame.contentDocument;
    const child = doc?.body.firstElementChild as HTMLElement | null;
    return {
      i,
      wrapper: el.getBoundingClientRect().toJSON(),
      shell: shell.getBoundingClientRect().toJSON(),
      shellHeight: shell.style.height,
      frame: frame.getBoundingClientRect().toJSON(),
      frameInline: frame.getAttribute("style"),
      bodyScroll: { w: doc?.body.scrollWidth, h: doc?.body.scrollHeight },
      child: child?.tagName,
      childRect: child?.getBoundingClientRect().toJSON(),
      text: doc?.body.innerText,
    };
  });
  const pre = document.createElement("pre");
  pre.id = "metrics";
  pre.textContent = JSON.stringify(data, null, 2);
  document.body.append(pre);
}, 1500);