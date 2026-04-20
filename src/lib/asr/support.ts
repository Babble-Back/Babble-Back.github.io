function isIosBrowser() {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;

  return /iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function getCampaignBrowserScoringError() {
  if (!isIosBrowser()) {
    return null;
  }

  return 'Campaign speech scoring is temporarily disabled on iPhone and iPad browsers because the on-device Whisper model can cause Safari/WebKit to freeze or reload. Use a desktop browser for campaign runs for now.';
}
