export type WechatPayResult = "ok" | "cancel" | "fail" | "unavailable";

type WeixinBridge = {
  invoke(
    name: "getBrandWCPayRequest",
    parameters: Record<string, unknown>,
    callback: (result: { err_msg?: string }) => void,
  ): void;
};

declare global {
  interface Window {
    WeixinJSBridge?: WeixinBridge;
  }
}

export function invokeWechatPay(parameters: Record<string, unknown> | null | undefined) {
  if (typeof window === "undefined" || !parameters || !window.WeixinJSBridge) {
    return Promise.resolve<WechatPayResult>("unavailable");
  }
  return new Promise<WechatPayResult>((resolve) => {
    window.WeixinJSBridge!.invoke("getBrandWCPayRequest", parameters, (result) => {
      const status = result.err_msg ?? "";
      if (status.endsWith(":ok")) resolve("ok");
      else if (status.endsWith(":cancel")) resolve("cancel");
      else resolve("fail");
    });
  });
}

