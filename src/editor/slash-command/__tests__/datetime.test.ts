import { describe, expect, it } from "vitest";
import { formatDateTime } from "../datetime";

describe("斜杠菜单日期/时间格式化", () => {
  const now = new Date(2026, 10, 5, 9, 7, 8);

  it("支持 ISO 日期、时间与日期时间", () => {
    expect(formatDateTime("date", now)).toBe("2026-11-05");
    expect(formatDateTime("time", now)).toBe("09:07");
    expect(formatDateTime("datetime", now)).toBe("2026-11-05 09:07");
    expect(formatDateTime("timeWithSeconds", now)).toBe("09:07:08");
  });

  it("支持中文日期与中文日期时间", () => {
    expect(formatDateTime("chineseDate", now)).toBe("2026年11月5日");
    expect(formatDateTime("chineseDatetime", now)).toBe("2026年11月5日 09:07");
  });

  it("使用本机本地时间而非 UTC", () => {
    // UTC 2026-11-05 01:02:03;上海本地时间应为同日 09:02:03。
    // 测试环境时区不固定,因此用 Date 构造器的本地时间口径验证字段来源。
    const local = new Date(2026, 10, 5, 23, 59, 59);
    expect(formatDateTime("timeWithSeconds", local)).toBe("23:59:59");
  });
});
