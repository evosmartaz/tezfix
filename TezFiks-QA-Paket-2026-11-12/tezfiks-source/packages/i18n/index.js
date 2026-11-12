'use strict';
// Static requires so Metro (React Native) and Next.js can bundle every app namespace.
const resources = {
  az: {
    common: require('./locales/az/common.json'),
    customer: require('./locales/az/customer.json'),
    pro: require('./locales/az/pro.json'),
    panel: require('./locales/az/panel.json'),
  },
  ru: {
    common: require('./locales/ru/common.json'),
    customer: require('./locales/ru/customer.json'),
    pro: require('./locales/ru/pro.json'),
    panel: require('./locales/ru/panel.json'),
  },
  en: {
    common: require('./locales/en/common.json'),
    customer: require('./locales/en/customer.json'),
    pro: require('./locales/en/pro.json'),
    panel: require('./locales/en/panel.json'),
  },
};

const LANGUAGES = ['az', 'ru', 'en'];
const NAMESPACES = ['common', 'customer', 'pro', 'panel'];

module.exports = { resources, LANGUAGES, NAMESPACES, DEFAULT_LANGUAGE: 'az' };
