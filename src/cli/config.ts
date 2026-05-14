import { loadConfig, setConfigValue, getConfigValue } from "../utils/config.js";
import { fmt } from "./format.js";

export function configShow(): void {
  console.log(JSON.stringify(loadConfig(), null, 2));
}

export function configGet(key: string): void {
  const value = getConfigValue(key);
  if (value === undefined) {
    console.log(fmt.err(`No config key: ${key}`));
    process.exitCode = 1;
    return;
  }
  if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}

export function configSet(key: string, value: string): void {
  try {
    setConfigValue(key, value);
    console.log(fmt.ok(`Set ${key} = ${value}`));
  } catch (e) {
    console.log(fmt.err((e as Error).message));
    process.exitCode = 1;
  }
}
