"use client";

import { useSyncExternalStore } from "react";

const key = "oopsie-reduced-motion";
const eventName = "oopsie-motion-changed";

function readPreference() {
  try {
    return window.localStorage.getItem(key) === "on";
  } catch {
    return false;
  }
}

function subscribe(notify: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === key || event.key === null) notify();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(eventName, notify);
  };
}

export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribe, readPreference, () => false);
}

export function saveMotionPreference(reduced: boolean) {
  window.localStorage.setItem(key, reduced ? "on" : "off");
  window.dispatchEvent(new Event(eventName));
}
