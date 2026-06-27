import { Request } from 'express';

export interface PluginProvider {
  id: string;
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResultPage>;
  fetch(pluginId: string): Promise<PluginDetails>;
  download(pluginId: string, versionId: string): Promise<DownloadAsset>;
}

export interface SearchOptions {
  category?: string;
  platform?: string; // 'paper', 'spigot', 'velocity', etc.
  version?: string;  // MC version, e.g. '1.20.4'
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'updated';
}

export interface SearchResultPage {
  results: PluginSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface PluginSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  rating: number;
  latestVersion: string;
  supportedVersions: string[];
  supportedPlatforms: string[];
  isVerified: boolean;
  isOpenSource: boolean;
  isPremium: boolean;
  provider: string;
}

export interface PluginDetails extends PluginSummary {
  longDescription: string;
  gallery: string[];
  wikiUrl: string | null;
  sourceUrl: string | null;
  issuesUrl: string | null;
  license: string | null;
  dependencies: PluginDependencyInfo[];
  versions: PluginVersionInfo[];
}

export interface PluginDependencyInfo {
  id: string;
  name: string;
  type: 'required' | 'optional';
}

export interface PluginVersionInfo {
  versionId: string;
  versionNumber: string;
  releaseType: 'release' | 'beta' | 'alpha';
  changelog: string | null;
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  checksum: string | null;
  gameVersions: string[];
  serverTypes: string[];
}

export interface DownloadAsset {
  url: string;
  filename: string;
  size: number;
  checksum: string | null;
  checksumType: 'sha256' | 'sha1' | 'sha512' | null;
}

export interface PluginEventPayloads {
  'plugin.install.queued': { serverId: string; pluginId: string; versionId: string; name: string };
  'plugin.install.started': { serverId: string; pluginId: string; versionId: string; name: string };
  'plugin.install.progress': { serverId: string; pluginId: string; versionId: string; name: string; stage: string; progress: number; logs: string };
  'plugin.install.completed': { serverId: string; pluginId: string; versionId: string; name: string };
  'plugin.install.failed': { serverId: string; pluginId: string; versionId: string; name: string; error: string };
  'plugin.update.available': { serverId: string; pluginId: string; currentVersion: string; latestVersion: string };
  'plugin.security.failed': { serverId: string; pluginId: string; versionId: string; filename: string; reason: string };
}
