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
  if (typeof window === "undefined" || !parameters) {
    return Promise.resolve<WechatPayResult>("unavailable");
  }
  return waitForBridge().then((bridge) => {
    if (!bridge) return "unavailable" as const;
    return new Promise<WechatPayResult>((resolve) => bridge.invoke("getBrandWCPayRequest", parameters, (result) => {
      const status = result.err_msg ?? "";
      if (status.endsWith(":ok")) resolve("ok");
      else if (status.endsWith(":cancel")) resolve("cancel");
      else resolve("fail");
    }));
  });
}

function waitForBridge() {
  if (window.WeixinJSBridge) return Promise.resolve(window.WeixinJSBridge);
  return new Promise<WeixinBridge | undefined>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      document.removeEventListener("WeixinJSBridgeReady", finish);
      resolve(window.WeixinJSBridge);
    };
    const timer = window.setTimeout(finish, 5_000);
    document.addEventListener("WeixinJSBridgeReady", finish, { once: true });
  });
}
