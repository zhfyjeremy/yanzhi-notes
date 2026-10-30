import pkg from "../package.json";

/** 应用版本(关于页展示):与 package.json / tauri.conf.json 三处同值,发布时同步改 */
export const APP_VERSION: string = pkg.version;
