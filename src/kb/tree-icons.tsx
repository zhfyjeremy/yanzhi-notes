import {
  AlarmClock,
  Archive,
  Award,
  BadgeCheck,
  Bell,
  BookOpen,
  Bookmark,
  Boxes,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Crown,
  Database,
  Droplet,
  FileCode2,
  FileText,
  Flame,
  Folder,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  House,
  KeyRound,
  Leaf,
  Link,
  Lock,
  Inbox,
  Landmark,
  Lightbulb,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Moon,
  Music,
  NotebookPen,
  Package,
  Palette,
  Paperclip,
  Plane,
  Rocket,
  Scale,
  Puzzle,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Sun,
  Table2,
  Tag,
  Target,
  Terminal,
  Trophy,
  Wallet,
  Zap,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 内置目录树图标白名单。meta 只保存稳定字符串 ID;
 * 渲染层查表拿 Lucide 组件,未知 ID 回退默认文件夹/文档图标。
 */
export interface TreeIconDef {
  id: string;
  label: string;
  group: string;
  keywords: string[];
  Icon: LucideIcon;
}
type LucideProps = ComponentProps<LucideIcon>;

/**
 * 彩色线条图标:不加底色、不缩放图形,与单色图标占满同一尺寸;
 * 颜色仍来自 design tokens,浅深主题各自适配。
 */
function colorIcon(Base: LucideIcon, foreground: string): LucideIcon {
  const ColorIcon = ({ className, ...props }: LucideProps) => (
    <Base
      {...props}
      className={cn(className, foreground)}
      strokeWidth={2.35}
    />
  );
  return ColorIcon as LucideIcon;
}

/** 面性彩色图标:直接填充整个图形,不加底色、不缩小图形。 */
function solidColorIcon(Base: LucideIcon, foreground: string): LucideIcon {
  const SolidColorIcon = ({ className, ...props }: LucideProps) => (
    <Base
      {...props}
      className={cn(className, foreground)}
      fill="currentColor"
      strokeWidth={1.5}
    />
  );
  return SolidColorIcon as LucideIcon;
}

export const TREE_ICON_GROUPS = [
  "通用", "工作", "学习", "技术", "生活", "媒体", "状态", "对象", "自然", "彩色", "彩色面性",
] as const;

export const TREE_ICONS: TreeIconDef[] = [
  { id: "folder", label: "文件夹", group: "通用", keywords: ["directory", "默认"], Icon: Folder },
  { id: "file", label: "文档", group: "通用", keywords: ["document", "默认"], Icon: FileText },
  { id: "note", label: "笔记", group: "通用", keywords: ["notebook", "随笔"], Icon: NotebookPen },
  { id: "star", label: "星标", group: "通用", keywords: ["重要", "收藏"], Icon: Star },
  { id: "tag", label: "标签", group: "通用", keywords: ["分类"], Icon: Tag },
  { id: "archive", label: "归档", group: "通用", keywords: ["箱", "历史"], Icon: Archive },
  { id: "inbox", label: "收件箱", group: "通用", keywords: ["收集", "待整理"], Icon: Inbox },

  { id: "briefcase", label: "工作", group: "工作", keywords: ["职场", "项目"], Icon: Briefcase },
  { id: "target", label: "目标", group: "工作", keywords: ["OKR", "指标"], Icon: Target },
  { id: "task", label: "任务", group: "工作", keywords: ["完成", "待办"], Icon: CheckCircle2 },
  { id: "calendar", label: "日历", group: "工作", keywords: ["日程", "时间"], Icon: Calendar },
  { id: "rocket", label: "发布", group: "工作", keywords: ["上线", "发布"], Icon: Rocket },
  { id: "landmark", label: "机构", group: "工作", keywords: ["组织", "账号"], Icon: Landmark },
  { id: "wallet", label: "财务", group: "工作", keywords: ["钱", "账本"], Icon: Wallet },

  { id: "book", label: "书籍", group: "学习", keywords: ["阅读"], Icon: BookOpen },
  { id: "graduation", label: "学习", group: "学习", keywords: ["课程", "学校"], Icon: GraduationCap },
  { id: "lightbulb", label: "想法", group: "学习", keywords: ["灵感"], Icon: Lightbulb },
  { id: "compass", label: "方向", group: "学习", keywords: ["路线", "指南"], Icon: Compass },
  { id: "map", label: "计划", group: "学习", keywords: ["路线图", "规划"], Icon: MapIcon },

  { id: "code", label: "代码", group: "技术", keywords: ["开发", "编程"], Icon: Code2 },
  { id: "file-code", label: "代码文档", group: "技术", keywords: ["源码"], Icon: FileCode2 },
  { id: "terminal", label: "终端", group: "技术", keywords: ["命令行", "shell"], Icon: Terminal },
  { id: "database", label: "数据", group: "技术", keywords: ["数据库"], Icon: Database },
  { id: "bug", label: "问题", group: "技术", keywords: ["缺陷", "debug"], Icon: Bug },
  { id: "wrench", label: "工具", group: "技术", keywords: ["配置", "维护"], Icon: Wrench },
  { id: "settings", label: "设置", group: "技术", keywords: ["系统"], Icon: Settings },
  { id: "boxes", label: "模块", group: "技术", keywords: ["组件", "包"], Icon: Boxes },
  { id: "cpu", label: "硬件", group: "技术", keywords: ["芯片", "性能"], Icon: Cpu },
  { id: "table", label: "表格", group: "技术", keywords: ["数据", "清单"], Icon: Table2 },

  { id: "house", label: "生活", group: "生活", keywords: ["家庭", "日常"], Icon: House },
  { id: "heart", label: "喜欢", group: "生活", keywords: ["收藏", "情感"], Icon: Heart },
  { id: "palette", label: "创作", group: "生活", keywords: ["设计", "画板"], Icon: Palette },

  { id: "camera", label: "照片", group: "媒体", keywords: ["摄影", "图片"], Icon: Camera },
  { id: "music", label: "音乐", group: "媒体", keywords: ["音频"], Icon: Music },
  { id: "plane", label: "旅行", group: "媒体", keywords: ["出行", "游记"], Icon: Plane },

  { id: "alarm", label: "提醒", group: "状态", keywords: ["闹钟", "时间"], Icon: AlarmClock },
  { id: "award", label: "荣誉", group: "状态", keywords: ["奖牌", "成绩"], Icon: Award },
  { id: "bell", label: "通知", group: "状态", keywords: ["消息", "提醒"], Icon: Bell },
  { id: "bookmark", label: "书签", group: "状态", keywords: ["收藏", "标记"], Icon: Bookmark },
  { id: "verified", label: "已验证", group: "状态", keywords: ["认证", "可靠"], Icon: BadgeCheck },
  { id: "alert", label: "重要", group: "状态", keywords: ["警告", "风险"], Icon: CircleAlert },
  { id: "shield", label: "安全", group: "状态", keywords: ["防护", "权限"], Icon: Shield },
  { id: "lock", label: "私密", group: "状态", keywords: ["加密", "锁定"], Icon: Lock },
  { id: "key", label: "密钥", group: "状态", keywords: ["密码", "访问"], Icon: KeyRound },
  { id: "trophy", label: "奖杯", group: "状态", keywords: ["冠军", "成果"], Icon: Trophy },

  { id: "cloud", label: "云端概念", group: "对象", keywords: ["云", "同步设计"], Icon: Cloud },
  { id: "globe", label: "网站", group: "对象", keywords: ["互联网", "全球"], Icon: Globe },
  { id: "link", label: "链接", group: "对象", keywords: ["引用", "URL"], Icon: Link },
  { id: "mail", label: "邮件", group: "对象", keywords: ["信件", "联系"], Icon: Mail },
  { id: "message", label: "对话", group: "对象", keywords: ["聊天", "讨论"], Icon: MessageCircle },
  { id: "paperclip", label: "附件", group: "对象", keywords: ["文件", "夹带"], Icon: Paperclip },
  { id: "package", label: "产品", group: "对象", keywords: ["包", "交付"], Icon: Package },
  { id: "gift", label: "礼物", group: "对象", keywords: ["福利", "活动"], Icon: Gift },
  { id: "shopping", label: "购物", group: "对象", keywords: ["消费", "清单"], Icon: ShoppingBag },
  { id: "scale", label: "平衡", group: "对象", keywords: ["法律", "对比"], Icon: Scale },
  { id: "puzzle", label: "模块拼图", group: "对象", keywords: ["集成", "组合"], Icon: Puzzle },

  { id: "leaf", label: "自然", group: "自然", keywords: ["植物", "环保"], Icon: Leaf },
  { id: "droplet", label: "水滴", group: "自然", keywords: ["液体", "清新"], Icon: Droplet },
  { id: "sun", label: "阳光", group: "自然", keywords: ["白天", "天气"], Icon: Sun },
  { id: "moon", label: "夜晚", group: "自然", keywords: ["夜", "睡眠"], Icon: Moon },

  { id: "color-folder-blue", label: "蓝色文件夹", group: "彩色", keywords: ["文件夹", "蓝色"], Icon: colorIcon(Folder, "text-primary") },
  { id: "color-cloud-blue", label: "蓝色云", group: "彩色", keywords: ["云", "蓝色"], Icon: colorIcon(Cloud, "text-primary") },
  { id: "color-shield-blue", label: "蓝色盾牌", group: "彩色", keywords: ["安全", "蓝色"], Icon: colorIcon(Shield, "text-primary") },
  { id: "color-check-green", label: "绿色完成", group: "彩色", keywords: ["完成", "绿色"], Icon: colorIcon(CheckCircle2, "text-[var(--callout-success)]") },
  { id: "color-leaf-green", label: "绿色叶子", group: "彩色", keywords: ["自然", "绿色"], Icon: colorIcon(Leaf, "text-[var(--callout-success)]") },
  { id: "color-star-amber", label: "琥珀星标", group: "彩色", keywords: ["星标", "黄色"], Icon: colorIcon(Star, "text-[var(--callout-warning)]") },
  { id: "color-sun-amber", label: "琥珀太阳", group: "彩色", keywords: ["太阳", "黄色"], Icon: colorIcon(Sun, "text-[var(--callout-warning)]") },
  { id: "color-flame-amber", label: "琥珀火焰", group: "彩色", keywords: ["热门", "橙色"], Icon: colorIcon(Flame, "text-[var(--callout-warning)]") },
  { id: "color-crown-amber", label: "琥珀皇冠", group: "彩色", keywords: ["会员", "尊贵"], Icon: colorIcon(Crown, "text-[var(--callout-warning)]") },
  { id: "color-zap-amber", label: "琥珀闪电", group: "彩色", keywords: ["能量", "快"], Icon: colorIcon(Zap, "text-[var(--callout-warning)]") },
  { id: "color-heart-red", label: "红色喜欢", group: "彩色", keywords: ["喜欢", "红色"], Icon: colorIcon(Heart, "text-destructive") },
  { id: "color-alert-red", label: "红色警告", group: "彩色", keywords: ["警告", "红色"], Icon: colorIcon(CircleAlert, "text-destructive") },
  { id: "color-code-purple", label: "紫色代码", group: "彩色", keywords: ["代码", "紫色"], Icon: colorIcon(Code2, "text-[var(--code-fn)]") },
  { id: "color-droplet-cyan", label: "青色水滴", group: "彩色", keywords: ["水滴", "青色"], Icon: colorIcon(Droplet, "text-[var(--code-emb)]") },

  { id: "color-note-blue", label: "蓝色笔记", group: "彩色", keywords: ["笔记", "蓝色"], Icon: colorIcon(NotebookPen, "text-primary") },
  { id: "color-work-blue", label: "蓝色工作", group: "彩色", keywords: ["工作", "蓝色"], Icon: colorIcon(Briefcase, "text-primary") },
  { id: "color-target-red", label: "红色目标", group: "彩色", keywords: ["目标", "红色"], Icon: colorIcon(Target, "text-destructive") },
  { id: "color-calendar-green", label: "绿色日程", group: "彩色", keywords: ["日程", "绿色"], Icon: colorIcon(Calendar, "text-[var(--callout-success)]") },
  { id: "color-wallet-green", label: "绿色财务", group: "彩色", keywords: ["财务", "绿色"], Icon: colorIcon(Wallet, "text-[var(--callout-success)]") },
  { id: "color-book-blue", label: "蓝色书籍", group: "彩色", keywords: ["书籍", "蓝色"], Icon: colorIcon(BookOpen, "text-primary") },
  { id: "color-graduation-blue", label: "蓝色学习", group: "彩色", keywords: ["学习", "蓝色"], Icon: colorIcon(GraduationCap, "text-primary") },
  { id: "color-lightbulb-amber", label: "琥珀想法", group: "彩色", keywords: ["想法", "黄色"], Icon: colorIcon(Lightbulb, "text-[var(--callout-warning)]") },
  { id: "color-compass-cyan", label: "青色方向", group: "彩色", keywords: ["方向", "青色"], Icon: colorIcon(Compass, "text-[var(--code-emb)]") },
  { id: "color-map-green", label: "绿色计划", group: "彩色", keywords: ["计划", "绿色"], Icon: colorIcon(MapIcon, "text-[var(--callout-success)]") },
  { id: "color-terminal-green", label: "绿色终端", group: "彩色", keywords: ["终端", "绿色"], Icon: colorIcon(Terminal, "text-[var(--callout-success)]") },
  { id: "color-file-code-purple", label: "紫色代码文档", group: "彩色", keywords: ["源码", "紫色"], Icon: colorIcon(FileCode2, "text-[var(--code-fn)]") },
  { id: "color-database-purple", label: "紫色数据", group: "彩色", keywords: ["数据", "紫色"], Icon: colorIcon(Database, "text-[var(--code-fn)]") },
  { id: "color-bug-red", label: "红色问题", group: "彩色", keywords: ["缺陷", "红色"], Icon: colorIcon(Bug, "text-destructive") },
  { id: "color-settings-blue", label: "蓝色设置", group: "彩色", keywords: ["设置", "蓝色"], Icon: colorIcon(Settings, "text-primary") },
  { id: "color-boxes-cyan", label: "青色模块", group: "彩色", keywords: ["模块", "青色"], Icon: colorIcon(Boxes, "text-[var(--code-emb)]") },
  { id: "color-table-green", label: "绿色表格", group: "彩色", keywords: ["表格", "绿色"], Icon: colorIcon(Table2, "text-[var(--callout-success)]") },
  { id: "color-house-orange", label: "橙色生活", group: "彩色", keywords: ["生活", "家庭"], Icon: colorIcon(House, "text-[var(--callout-warning)]") },
  { id: "color-palette-purple", label: "紫色创作", group: "彩色", keywords: ["创作", "紫色"], Icon: colorIcon(Palette, "text-[var(--code-fn)]") },
  { id: "color-camera-cyan", label: "青色照片", group: "彩色", keywords: ["照片", "青色"], Icon: colorIcon(Camera, "text-[var(--code-emb)]") },
  { id: "color-music-purple", label: "紫色音乐", group: "彩色", keywords: ["音乐", "紫色"], Icon: colorIcon(Music, "text-[var(--code-fn)]") },
  { id: "color-plane-blue", label: "蓝色旅行", group: "彩色", keywords: ["旅行", "蓝色"], Icon: colorIcon(Plane, "text-primary") },
  { id: "color-package-orange", label: "橙色产品", group: "彩色", keywords: ["产品", "橙色"], Icon: colorIcon(Package, "text-[var(--callout-warning)]") },
  { id: "color-globe-cyan", label: "青色网站", group: "彩色", keywords: ["网站", "青色"], Icon: colorIcon(Globe, "text-[var(--code-emb)]") },
  { id: "color-mail-blue", label: "蓝色邮件", group: "彩色", keywords: ["邮件", "蓝色"], Icon: colorIcon(Mail, "text-primary") },
  { id: "color-message-green", label: "绿色对话", group: "彩色", keywords: ["对话", "绿色"], Icon: colorIcon(MessageCircle, "text-[var(--callout-success)]") },

  { id: "solid-folder-blue", label: "面性蓝色文件夹", group: "彩色面性", keywords: ["文件夹", "面性", "蓝色"], Icon: solidColorIcon(Folder, "text-primary") },
  { id: "solid-star-amber", label: "面性琥珀星标", group: "彩色面性", keywords: ["星标", "面性", "黄色"], Icon: solidColorIcon(Star, "text-[var(--callout-warning)]") },
  { id: "solid-heart-red", label: "面性红色喜欢", group: "彩色面性", keywords: ["喜欢", "面性", "红色"], Icon: solidColorIcon(Heart, "text-destructive") },
  { id: "solid-cloud-blue", label: "面性蓝色云", group: "彩色面性", keywords: ["云", "面性", "蓝色"], Icon: solidColorIcon(Cloud, "text-primary") },
  { id: "solid-shield-blue", label: "面性蓝色盾牌", group: "彩色面性", keywords: ["安全", "面性", "蓝色"], Icon: solidColorIcon(Shield, "text-primary") },
  { id: "solid-leaf-green", label: "面性绿色叶子", group: "彩色面性", keywords: ["自然", "面性", "绿色"], Icon: solidColorIcon(Leaf, "text-[var(--callout-success)]") },
  { id: "solid-droplet-cyan", label: "面性青色水滴", group: "彩色面性", keywords: ["水滴", "面性", "青色"], Icon: solidColorIcon(Droplet, "text-[var(--code-emb)]") },
  { id: "solid-zap-amber", label: "面性琥珀闪电", group: "彩色面性", keywords: ["能量", "面性", "黄色"], Icon: solidColorIcon(Zap, "text-[var(--callout-warning)]") },
  { id: "solid-flame-orange", label: "面性橙色火焰", group: "彩色面性", keywords: ["热门", "面性", "橙色"], Icon: solidColorIcon(Flame, "text-[var(--callout-warning)]") },
  { id: "solid-crown-amber", label: "面性琥珀皇冠", group: "彩色面性", keywords: ["尊贵", "面性", "黄色"], Icon: solidColorIcon(Crown, "text-[var(--callout-warning)]") },
  { id: "solid-bell-amber", label: "面性琥珀通知", group: "彩色面性", keywords: ["通知", "面性", "黄色"], Icon: solidColorIcon(Bell, "text-[var(--callout-warning)]") },
  { id: "solid-bookmark-blue", label: "面性蓝色书签", group: "彩色面性", keywords: ["书签", "面性", "蓝色"], Icon: solidColorIcon(Bookmark, "text-primary") },
  { id: "solid-briefcase-blue", label: "面性蓝色工作", group: "彩色面性", keywords: ["工作", "面性", "蓝色"], Icon: solidColorIcon(Briefcase, "text-primary") },
  { id: "solid-calendar-green", label: "面性绿色日程", group: "彩色面性", keywords: ["日程", "面性", "绿色"], Icon: solidColorIcon(Calendar, "text-[var(--callout-success)]") },
  { id: "solid-house-orange", label: "面性橙色生活", group: "彩色面性", keywords: ["生活", "面性", "家庭"], Icon: solidColorIcon(House, "text-[var(--callout-warning)]") },
  { id: "solid-plane-blue", label: "面性蓝色旅行", group: "彩色面性", keywords: ["旅行", "面性", "蓝色"], Icon: solidColorIcon(Plane, "text-primary") },
  { id: "solid-package-orange", label: "面性橙色产品", group: "彩色面性", keywords: ["产品", "面性", "橙色"], Icon: solidColorIcon(Package, "text-[var(--callout-warning)]") },
  { id: "solid-mail-blue", label: "面性蓝色邮件", group: "彩色面性", keywords: ["邮件", "面性", "蓝色"], Icon: solidColorIcon(Mail, "text-primary") },
  { id: "solid-message-green", label: "面性绿色对话", group: "彩色面性", keywords: ["对话", "面性", "绿色"], Icon: solidColorIcon(MessageCircle, "text-[var(--callout-success)]") },
  { id: "solid-target-red", label: "面性红色目标", group: "彩色面性", keywords: ["目标", "面性", "红色"], Icon: solidColorIcon(Target, "text-destructive") },
  { id: "solid-wallet-green", label: "面性绿色财务", group: "彩色面性", keywords: ["财务", "面性", "绿色"], Icon: solidColorIcon(Wallet, "text-[var(--callout-success)]") },
  { id: "solid-camera-cyan", label: "面性青色照片", group: "彩色面性", keywords: ["照片", "面性", "青色"], Icon: solidColorIcon(Camera, "text-[var(--code-emb)]") },
  { id: "solid-music-purple", label: "面性紫色音乐", group: "彩色面性", keywords: ["音乐", "面性", "紫色"], Icon: solidColorIcon(Music, "text-[var(--code-fn)]") },
  { id: "solid-palette-purple", label: "面性紫色创作", group: "彩色面性", keywords: ["创作", "面性", "紫色"], Icon: solidColorIcon(Palette, "text-[var(--code-fn)]") },
];

const ICON_MAP = new Map(TREE_ICONS.map((def): [string, TreeIconDef] => [def.id, def]));

export function isTreeIconId(id: unknown): id is string {
  return typeof id === "string" && ICON_MAP.has(id);
}

export function treeIconComponent(id: string | null | undefined): LucideIcon | null {
  return id ? (ICON_MAP.get(id)?.Icon ?? null) : null;
}

export function treeIconLabel(id: string | null | undefined): string {
  return (id && ICON_MAP.get(id)?.label) || "默认";
}
