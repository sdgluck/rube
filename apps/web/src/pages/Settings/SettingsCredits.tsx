import SettingsPageHeader from "./SettingsPageHeader";
import local from "./SettingsCredits.module.css";

type Credit = {
  name: string;
  url: string;
  note?: string;
};

type Section = {
  title: string;
  blurb?: string;
  items: Credit[];
};

const SECTIONS: Section[] = [
  {
    title: "Image assets",
    blurb:
      "Collection posters are sourced on demand from the Kometa default-images set when enabled in Settings → Posters. Imagery is © respective rights holders; thanks to the Kometa community for curating it.",
    items: [
      {
        name: "Kometa Default-Images",
        url: "https://github.com/Kometa-Team/Default-Images",
        note: "studio, network, genre, country, decade, etc.",
      },
      {
        name: "Kometa People-Images",
        url: "https://github.com/Kometa-Team/People-Images",
        note: "actor / director portraits (multiple style repos)",
      },
      {
        name: "Kometa",
        url: "https://github.com/Kometa-Team/Kometa",
        note: "the upstream project these assets ship with",
      },
      { name: "TMDb", url: "https://www.themoviedb.org/", note: "underlying actor headshots and metadata" },
    ],
  },
  {
    title: "Frontend",
    items: [
      { name: "React", url: "https://github.com/facebook/react" },
      { name: "React Router", url: "https://github.com/remix-run/react-router" },
      { name: "Vite", url: "https://github.com/vitejs/vite" },
      { name: "@vitejs/plugin-react", url: "https://github.com/vitejs/vite-plugin-react" },
      { name: "TanStack Query", url: "https://github.com/TanStack/query" },
      { name: "tRPC", url: "https://github.com/trpc/trpc" },
      { name: "Lucide", url: "https://github.com/lucide-icons/lucide" },
      { name: "Fuse.js", url: "https://github.com/krisk/Fuse" },
    ],
  },
  {
    title: "Server",
    items: [
      { name: "Sidequest", url: "https://github.com/sidequestjs/sidequest", note: "background job runner" },
      { name: "Croner", url: "https://github.com/Hexagon/croner", note: "cron scheduling" },
      { name: "Sharp", url: "https://github.com/lovell/sharp", note: "image composition for overlays" },
      { name: "opentype.js", url: "https://github.com/opentypejs/opentype.js", note: "font parsing for overlays" },
      { name: "p-map", url: "https://github.com/sindresorhus/p-map" },
      { name: "p-queue", url: "https://github.com/sindresorhus/p-queue" },
      { name: "Zod", url: "https://github.com/colinhacks/zod" },
      {
        name: "Anthropic SDK",
        url: "https://github.com/anthropics/anthropic-sdk-typescript",
        note: "powers the AI rule wizard",
      },
    ],
  },
  {
    title: "Database",
    items: [
      { name: "Drizzle ORM", url: "https://github.com/drizzle-team/drizzle-orm" },
      { name: "Drizzle Kit", url: "https://github.com/drizzle-team/drizzle-kit-mirror" },
      { name: "better-sqlite3", url: "https://github.com/WiseLibs/better-sqlite3" },
    ],
  },
  {
    title: "Tooling",
    items: [
      { name: "TypeScript", url: "https://github.com/microsoft/TypeScript" },
      { name: "Turborepo", url: "https://github.com/vercel/turborepo" },
      { name: "pnpm", url: "https://github.com/pnpm/pnpm" },
      { name: "oxlint", url: "https://github.com/oxc-project/oxc" },
      { name: "oxfmt", url: "https://github.com/oxc-project/oxc" },
      { name: "Husky", url: "https://github.com/typicode/husky" },
      { name: "lint-staged", url: "https://github.com/lint-staged/lint-staged" },
      { name: "portless", url: "https://github.com/akellbl4/portless" },
    ],
  },
];

export default function SettingsCredits() {
  return (
    <div className={local.page}>
      <SettingsPageHeader
        title="Credits"
        description="Tinkerbell is built on the work of many open-source projects. Thanks to all the maintainers below."
      />

      {SECTIONS.map((section) => (
        <section key={section.title} className={local.section}>
          <h3 className={section.blurb ? local.titleWithBlurb : local.title}>{section.title}</h3>
          {section.blurb && <p className={local.blurb}>{section.blurb}</p>}
          <ul className={local.list}>
            {section.items.map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.name}
                </a>
                {item.note && <span className={local.note}> — {item.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
