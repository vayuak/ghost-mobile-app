// Single source of truth for every external URL the app opens.
export const SITE = 'https://www.warnpack.com';

export const LINKS = {
  terms: `${SITE}/terms-of-service/`,
  privacy: `${SITE}/privacy-policy/`,
  guidelines: `${SITE}/community-guidelines/`,
  help: `${SITE}/help/`,
  deleteAccount: `${SITE}/delete-account/`,
  contact: `${SITE}/contact/`,
  supportEmail: 'mailto:support@warnpack.com',
  bugEmail: 'mailto:support@warnpack.com?subject=WarnPack%20bug%20report',
  featureEmail: 'mailto:support@warnpack.com?subject=WarnPack%20feature%20request',
};

// Share links open the website landing page, which opens the app (Android App Links) or offers the download.
export const postShareUrl = (postId: string | number) => `${SITE}/post/${postId}`;
