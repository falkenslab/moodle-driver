import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "moodle-driver",
  tagline: "Full control of Moodle as any user, through a browser: no API, no web services, no tokens.",
  favicon: "img/logo.svg",

  url: "https://falkenslab.github.io",
  baseUrl: "/moodle-driver/",
  organizationName: "falkenslab",
  projectName: "moodle-driver",
  trailingSlash: false,

  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    mermaid: true,
    // .md files (the guides and the generated API reference) are CommonMark, not MDX: doc
    // comments hold `<placeholders>` MDX would read as tags.
    format: "detect",
    hooks: { onBrokenMarkdownLinks: "throw" },
  },

  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "content",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/falkenslab/moodle-driver/edit/main/docs/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      "docusaurus-plugin-typedoc",
      {
        entryPoints: ["../src/index.ts", "../src/internals.ts", "../src/testing/index.ts"],
        tsconfig: "../tsconfig.json",
        out: "content/api",
        readme: "none",
        excludePrivate: true,
        excludeInternal: true,
        excludeExternals: true,
        disableSources: false,
        sourceLinkTemplate: "https://github.com/falkenslab/moodle-driver/blob/main/{path}#L{line}",
        gitRevision: "main",
        parametersFormat: "table",
        interfacePropertiesFormat: "table",
        typeDeclarationFormat: "table",
        enumMembersFormat: "table",
        indexFormat: "table",
        useCodeBlocks: true,
        expandObjects: false,
        sidebar: { pretty: true },
      },
    ],
  ],

  themes: [
    "@docusaurus/theme-mermaid",
    [
      "@easyops-cn/docusaurus-search-local",
      { hashed: true, docsDir: "content", docsRouteBasePath: "/", indexBlog: false, highlightSearchTermsOnTargetPage: true },
    ],
  ],

  themeConfig: {
    // What GitHub, chat apps and social sites show for a shared link.
    image: "img/social-card.png",
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: "moodle-driver",
      logo: { alt: "moodle-driver", src: "img/logo.svg" },
      items: [
        { type: "docSidebar", sidebarId: "guides", position: "left", label: "Guides" },
        { type: "docSidebar", sidebarId: "api", position: "left", label: "API reference" },
        { href: "https://github.com/falkenslab/moodle-driver/releases", label: "Releases", position: "right" },
        { href: "https://github.com/falkenslab/moodle-driver", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            { label: "Getting started", to: "/getting-started/installation" },
            { label: "Moodle areas", to: "/areas/courses" },
            { label: "API reference", to: "/api" },
          ],
        },
        {
          title: "Project",
          items: [
            { label: "GitHub", href: "https://github.com/falkenslab/moodle-driver" },
            { label: "Releases", href: "https://github.com/falkenslab/moodle-driver/releases" },
            { label: "Design decisions (ADRs)", href: "https://github.com/falkenslab/moodle-driver/tree/main/.minispec/decisions" },
          ],
        },
        {
          title: "Related",
          items: [
            { label: "Playwright", href: "https://playwright.dev" },
            { label: "Moodle", href: "https://moodle.org" },
          ],
        },
      ],
      copyright: `MIT licensed. Copyright © ${new Date().getFullYear()} Francisco Vargas Ruiz.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "diff"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
