import type { ComponentType } from "react";
import { Toaster } from "@/ui/Toaster";

interface SectionModule {
  default: ComponentType;
  title: string;
  order: number;
}

// Each primitive task adds one file to ./sections; nothing else in the gallery changes.
const modules = import.meta.glob<SectionModule>("./sections/*.tsx", { eager: true });
const sections = Object.values(modules).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const slug = (title: string) => title.toLowerCase().replace(/\s+/g, "-");

/** Every ui/ primitive in one scrolling page, for the visual check against the mockups. */
export function Gallery() {
  return (
    <div className="mx-auto max-w-6xl px-8 pb-24 pt-6 text-ink">
      <h1>Kestrel primitives</h1>
      <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {sections.map((s) => (
          <a key={s.title} href={`#${slug(s.title)}`} className="text-sm text-accent-ink hover:underline">
            {s.title}
          </a>
        ))}
      </nav>
      {sections.map(({ title, default: Section }) => (
        <section key={title} id={slug(title)} aria-labelledby={`${slug(title)}-h`} className="mt-12">
          <h2 id={`${slug(title)}-h`} className="text-lg">
            {title}
          </h2>
          <div className="mt-4">
            <Section />
          </div>
        </section>
      ))}
      <Toaster />
    </div>
  );
}
