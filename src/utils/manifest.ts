export interface SidebarPage {
  type: "page";
  title: string;
  route: string;
  source: string;
  order?: number;
  numericPrefix?: string;
  isIndex: boolean;
}

export interface SidebarGroup {
  type: "group";
  title: string;
  route: string;
  source: string;
  order?: number;
  numericPrefix?: string;
  children: SidebarNode[];
  isIndex: false;
}

export type SidebarNode = SidebarPage | SidebarGroup;

export interface FlatPage {
  title: string;
  route: string;
  source: string;
  order?: number;
}

export interface ManifestProject {
  slug: string;
  category: string;
  accentColor: string;
  repoUrl?: string;
  branch?: string;
  docsPath?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  title: string;
  description: string;
  version?: string | number;
  logoUrl: string | null;
  sidebar: SidebarNode[];
  flatPages: FlatPage[];
}

export interface SiteConfig {
  portalTitle: string;
  portalSubtitle: string;
  domain: string;
  brandName: string;
  brandLogo: string;
  defaultAccent: string;
  portalType?: "users" | "developer" | "all";
  navLinks: Array<{ label: string; href: string }>;
}

export interface ProjectManifest {
  generatedAt: string;
  site: SiteConfig;
  categories: string[];
  projects: ManifestProject[];
}
