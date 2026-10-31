const vibrate = (pattern) => {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // API недоступно или заблокировано — тихо игнорируем
  }
};

export const hapticTap = () => vibrate(10);
export const hapticDeep = () => vibrate([25, 40, 25]);
export const hapticWarning = () => vibrate([40, 30, 60]);
