// 固定站点不再从链接导入配置，仅清除历史链接中的配置及密钥参数。
const URL_SETTING_KEYS = ['settings', 'apiUrl', 'apiKey', 'codexCli', 'apiMode', 'apiFormat', 'model', 'streamImages', 'streamPartialImages']

export function hasUrlSettingParams(searchParams: URLSearchParams) {
  return URL_SETTING_KEYS.some((key) => searchParams.has(key))
}

export function clearUrlSettingParams(searchParams: URLSearchParams) {
  for (const key of URL_SETTING_KEYS) searchParams.delete(key)
}
