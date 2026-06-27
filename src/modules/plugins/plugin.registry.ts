import axios from 'axios';
import {
  PluginProvider,
  SearchOptions,
  SearchResultPage,
  PluginDetails,
  DownloadAsset,
  PluginSummary,
  PluginDependencyInfo,
  PluginVersionInfo
} from './plugin.types';
import { ProviderHealthMonitor } from './plugin.health';
import logger from '../../handlers/logger';

// =============================================================================
// MODRINTH PROVIDER
// =============================================================================
export class ModrinthProvider implements PluginProvider {
  id = 'modrinth';
  name = 'Modrinth';

  async search(query: string, options?: SearchOptions): Promise<SearchResultPage> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    const facets: string[][] = [['project_type:plugin']];

    if (options?.category) {
      facets.push([`categories:${options.category}`]);
    }

    try {
      const startTime = Date.now();
      const response = await axios.get('https://api.modrinth.com/v2/search', {
        params: {
          query,
          limit,
          offset,
          facets: JSON.stringify(facets)
        },
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const results: PluginSummary[] = response.data.hits.map((hit: any) => ({
        id: hit.project_id,
        name: hit.title,
        author: hit.author,
        description: hit.description,
        iconUrl: hit.icon_url,
        downloads: hit.downloads,
        rating: hit.follows, // Modrinth uses follows as rating analogue
        latestVersion: hit.latest_version || 'Unknown',
        supportedVersions: hit.game_versions || [],
        supportedPlatforms: hit.categories || [],
        isVerified: hit.client_side === 'optional' || hit.server_side === 'required',
        isOpenSource: !!hit.source_url,
        isPremium: false, // Modrinth doesn't support paid mods natively on free API
        provider: this.id
      }));

      return {
        results,
        total: response.data.total_hits,
        limit,
        offset
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      logger.error(`Modrinth search failed: ${err.message}`);
      return { results: [], total: 0, limit, offset };
    }
  }

  async fetch(pluginId: string): Promise<PluginDetails> {
    const startTime = Date.now();
    try {
      // 1. Fetch project details
      const projectRes = await axios.get(`https://api.modrinth.com/v2/project/${pluginId}`, {
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });
      const p = projectRes.data;

      // 2. Fetch versions
      const versionsRes = await axios.get(`https://api.modrinth.com/v2/project/${pluginId}/version`, {
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const versions: PluginVersionInfo[] = versionsRes.data.map((v: any) => {
        const file = v.files.find((f: any) => f.primary) || v.files[0];
        return {
          versionId: v.id,
          versionNumber: v.version_number,
          releaseType: v.version_type, // 'release', 'beta', 'alpha'
          changelog: v.changelog,
          downloadUrl: file ? file.url : '',
          fileName: file ? file.filename : '',
          fileSize: file ? file.size : 0,
          checksum: file && file.hashes ? file.hashes.sha256 || file.hashes.sha1 : null,
          gameVersions: v.game_versions || [],
          serverTypes: v.loaders || []
        };
      });

      const dependencies: PluginDependencyInfo[] = (p.dependencies || []).map((d: any) => ({
        id: d.project_id || '',
        name: d.project_id || 'Dependency',
        type: d.dependency_type === 'required' ? 'required' : 'optional'
      }));

      return {
        id: p.id,
        name: p.title,
        author: p.team || 'Unknown',
        description: p.description,
        iconUrl: p.icon_url,
        downloads: p.downloads,
        rating: p.followers || 0,
        latestVersion: versions[0]?.versionNumber || 'Unknown',
        supportedVersions: p.game_versions || [],
        supportedPlatforms: p.categories || [],
        isVerified: true,
        isOpenSource: !!p.source_url,
        isPremium: false,
        provider: this.id,
        longDescription: p.body || p.description,
        gallery: (p.gallery || []).map((g: any) => g.url),
        wikiUrl: p.wiki_url,
        sourceUrl: p.source_url,
        issuesUrl: p.issues_url,
        license: p.license ? p.license.name : null,
        dependencies,
        versions
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      throw new Error(`Modrinth fetch failed: ${err.message}`);
    }
  }

  async download(pluginId: string, versionId: string): Promise<DownloadAsset> {
    const startTime = Date.now();
    try {
      const response = await axios.get(`https://api.modrinth.com/v2/version/${versionId}`, {
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });
      const v = response.data;
      const file = v.files.find((f: any) => f.primary) || v.files[0];
      if (!file) throw new Error('No files found in selected Modrinth version.');

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      return {
        url: file.url,
        filename: file.filename,
        size: file.size,
        checksum: file.hashes?.sha256 || null,
        checksumType: 'sha256'
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      throw new Error(`Modrinth download resolution failed: ${err.message}`);
    }
  }
}

// =============================================================================
// SPIGOTMC (SPIGET API) PROVIDER
// =============================================================================
export class SpigetProvider implements PluginProvider {
  id = 'spiget';
  name = 'SpigotMC';

  async search(query: string, options?: SearchOptions): Promise<SearchResultPage> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    try {
      const startTime = Date.now();
      // If query is empty, browse top resources
      const url = query 
        ? `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}` 
        : `https://api.spiget.org/v2/resources`;

      const response = await axios.get(url, {
        params: {
          size: limit,
          page: Math.floor(offset / limit) + 1,
          fields: 'id,name,tag,icon,downloads,rating,version,testedVersions'
        },
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const items = Array.isArray(response.data) ? response.data : [];
      const results: PluginSummary[] = items.map((item: any) => ({
        id: String(item.id),
        name: item.name,
        author: 'Spigot Author',
        description: item.tag || 'No description provided.',
        iconUrl: item.icon && item.icon.url ? `https://static.spigotmc.org/${item.icon.url}` : null,
        downloads: item.downloads || 0,
        rating: item.rating ? item.rating.average : 0,
        latestVersion: item.version ? item.version.name : 'Unknown',
        supportedVersions: item.testedVersions || [],
        supportedPlatforms: ['spigot', 'paper', 'bukkit'],
        isVerified: false,
        isOpenSource: false,
        isPremium: item.premium || false,
        provider: this.id
      }));

      return {
        results,
        total: results.length < limit ? offset + results.length : 1000, // Spiget total hits workaround
        limit,
        offset
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      logger.error(`Spiget search failed: ${err.message}`);
      return { results: [], total: 0, limit, offset };
    }
  }

  async fetch(pluginId: string): Promise<PluginDetails> {
    const startTime = Date.now();
    try {
      const res = await axios.get(`https://api.spiget.org/v2/resources/${pluginId}`, {
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });
      const r = res.data;

      const versionsRes = await axios.get(`https://api.spiget.org/v2/resources/${pluginId}/versions`, {
        params: { size: 10, sort: '-releaseDate' },
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const versions: PluginVersionInfo[] = (versionsRes.data || []).map((v: any) => ({
        versionId: String(v.id),
        versionNumber: v.name,
        releaseType: 'release',
        changelog: 'Released on SpigotMC',
        downloadUrl: `https://api.spiget.org/v2/resources/${pluginId}/versions/${v.id}/download`,
        fileName: `${r.name.replace(/\s+/g, '_')}-${v.name}.jar`,
        fileSize: 0, // Not provided directly by versions endpoint
        checksum: null,
        gameVersions: r.testedVersions || [],
        serverTypes: ['spigot', 'paper', 'bukkit']
      }));

      return {
        id: String(r.id),
        name: r.name,
        author: 'Spigot Author',
        description: r.tag,
        iconUrl: r.icon && r.icon.url ? `https://static.spigotmc.org/${r.icon.url}` : null,
        downloads: r.downloads,
        rating: r.rating ? r.rating.average : 0,
        latestVersion: r.version?.name || 'Unknown',
        supportedVersions: r.testedVersions || [],
        supportedPlatforms: ['spigot', 'paper', 'bukkit'],
        isVerified: true,
        isOpenSource: false,
        isPremium: r.premium || false,
        provider: this.id,
        longDescription: r.description || r.tag,
        gallery: [],
        wikiUrl: null,
        sourceUrl: r.sourceCodeLink || null,
        issuesUrl: r.donationLink || null,
        license: null,
        dependencies: [],
        versions
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      throw new Error(`Spiget fetch failed: ${err.message}`);
    }
  }

  async download(pluginId: string, versionId: string): Promise<DownloadAsset> {
    // Spiget downloads are direct download endpoints, but premium plugins cannot be downloaded via API
    const details = await this.fetch(pluginId);
    if (details.isPremium) {
      throw new Error(`Plugin "${details.name}" is a Premium SpigotMC plugin. Direct API download is not supported. Please upload the JAR file manually.`);
    }

    return {
      url: `https://api.spiget.org/v2/resources/${pluginId}/versions/${versionId}/download`,
      filename: `${details.name.replace(/\s+/g, '_')}.jar`,
      size: 0,
      checksum: null,
      checksumType: null
    };
  }
}

// =============================================================================
// GITHUB RELEASES PROVIDER
// =============================================================================
export class GitHubProvider implements PluginProvider {
  id = 'github';
  name = 'GitHub';

  async search(query: string, options?: SearchOptions): Promise<SearchResultPage> {
    // If query is an owner/repo path (e.g. "EssentialsX/Essentials"), pull it.
    // Otherwise search GitHub repositories matching topic:minecraft-plugin
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    if (!query) {
      return { results: [], total: 0, limit, offset };
    }

    try {
      const startTime = Date.now();
      let url = 'https://api.github.com/search/repositories';
      let q = `${query} topic:minecraft-plugin`;
      
      // Check if it's direct owner/repo
      if (query.includes('/')) {
        const parts = query.split('/');
        const repoRes = await axios.get(`https://api.github.com/repos/${parts[0]}/${parts[1]}`, {
          headers: { 'User-Agent': 'CynexPanel/2.0.0' }
        });
        const repo = repoRes.data;
        ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);
        
        return {
          results: [this.mapRepoToSummary(repo)],
          total: 1,
          limit,
          offset
        };
      }

      const response = await axios.get(url, {
        params: { q, per_page: limit, page: Math.floor(offset / limit) + 1 },
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const results = (response.data.items || []).map((repo: any) => this.mapRepoToSummary(repo));
      return {
        results,
        total: response.data.total_count,
        limit,
        offset
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      logger.error(`GitHub search failed: ${err.message}`);
      return { results: [], total: 0, limit, offset };
    }
  }

  private mapRepoToSummary(repo: any): PluginSummary {
    return {
      id: repo.full_name,
      name: repo.name,
      author: repo.owner?.login || 'GitHub',
      description: repo.description || 'GitHub repository.',
      iconUrl: repo.owner?.avatar_url || null,
      downloads: repo.stargazers_count, // stars as downloads analogue
      rating: repo.stargazers_count,
      latestVersion: 'Latest',
      supportedVersions: ['1.20', '1.19', '1.18'],
      supportedPlatforms: ['spigot', 'paper', 'velocity', 'fabric'],
      isVerified: repo.stargazers_count > 100,
      isOpenSource: true,
      isPremium: false,
      provider: this.id
    };
  }

  async fetch(pluginId: string): Promise<PluginDetails> {
    const startTime = Date.now();
    try {
      const repoRes = await axios.get(`https://api.github.com/repos/${pluginId}`, {
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });
      const repo = repoRes.data;

      const releasesRes = await axios.get(`https://api.github.com/repos/${pluginId}/releases`, {
        params: { per_page: 5 },
        headers: { 'User-Agent': 'CynexPanel/2.0.0' }
      });

      ProviderHealthMonitor.recordRequest(this.id, Date.now() - startTime, true);

      const releases = Array.isArray(releasesRes.data) ? releasesRes.data : [];
      const versions: PluginVersionInfo[] = [];

      for (const rel of releases) {
        // Find .jar assets in the release
        const assets = rel.assets || [];
        const jarAsset = assets.find((a: any) => a.name.endsWith('.jar') || a.name.endsWith('.zip')) || assets[0];
        
        if (jarAsset) {
          versions.push({
            versionId: String(rel.id),
            versionNumber: rel.tag_name,
            releaseType: rel.prerelease ? 'beta' : 'release',
            changelog: rel.body || 'GitHub release notes.',
            downloadUrl: jarAsset.browser_download_url,
            fileName: jarAsset.name,
            fileSize: jarAsset.size,
            checksum: null,
            gameVersions: ['1.20.4', '1.20', '1.19'],
            serverTypes: ['spigot', 'paper', 'velocity']
          });
        }
      }

      const summary = this.mapRepoToSummary(repo);
      return {
        ...summary,
        longDescription: repo.description || 'No detailed description available.',
        gallery: [],
        wikiUrl: repo.homepage || null,
        sourceUrl: repo.html_url,
        issuesUrl: `${repo.html_url}/issues`,
        license: repo.license ? repo.license.name : null,
        dependencies: [],
        versions
      };
    } catch (err: any) {
      ProviderHealthMonitor.recordRequest(this.id, 0, false);
      throw new Error(`GitHub fetch failed: ${err.message}`);
    }
  }

  async download(pluginId: string, versionId: string): Promise<DownloadAsset> {
    const details = await this.fetch(pluginId);
    const version = details.versions.find(v => v.versionId === versionId);
    if (!version) {
      throw new Error(`Version ID ${versionId} not found for GitHub repo ${pluginId}`);
    }

    return {
      url: version.downloadUrl,
      filename: version.fileName,
      size: version.fileSize,
      checksum: null,
      checksumType: null
    };
  }
}

// =============================================================================
// REGISTRY MANAGER
// =============================================================================
class PluginRegistryService {
  private providers: Map<string, PluginProvider> = new Map();

  constructor() {
    this.registerProvider(new ModrinthProvider());
    this.registerProvider(new SpigetProvider());
    this.registerProvider(new GitHubProvider());
  }

  public registerProvider(provider: PluginProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): PluginProvider | undefined {
    return this.providers.get(id);
  }

  public getAllProviders(): PluginProvider[] {
    return Array.from(this.providers.values());
  }

  public async search(query: string, options?: SearchOptions): Promise<SearchResultPage> {
    // If options specify a single provider, use it. Otherwise, default to Modrinth.
    const providerId = options?.category === 'spigotmc' ? 'spiget' : 'modrinth';
    const provider = this.getProvider(providerId);
    
    if (!provider) {
      throw new Error(`No provider registered with ID: ${providerId}`);
    }
    
    return provider.search(query, options);
  }
}

export const PluginRegistry = new PluginRegistryService();
