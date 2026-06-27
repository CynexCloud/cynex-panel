import logger from '../../handlers/logger';

export interface ServerEnvironmentInfo {
  minecraftVersion: string;
  software: string; // 'paper' | 'purpur' | 'spigot' | 'folia' | 'velocity' | 'bungeecord' | 'fabric' | 'forge' | 'neoforge' | 'sponge'
  javaVersion: number;
}

export class CompatibilityMatrixService {
  /**
   * Resolves a server's environment details (software type, game version, Java version)
   * from its Prisma database fields (variables, start command, docker image).
   */
  public static resolveServerEnvironment(server: any): ServerEnvironmentInfo {
    let minecraftVersion = '1.20.4'; // fallback default
    let software = 'paper';          // fallback default
    let javaVersion = 17;            // fallback default

    // 1. Parse Variables
    if (server.Variables) {
      try {
        const vars = typeof server.Variables === 'string' ? JSON.parse(server.Variables) : server.Variables;
        if (Array.isArray(vars)) {
          const mcVar = vars.find(v => ['MINECRAFT_VERSION', 'MC_VERSION', 'VERSION', 'SERVER_VERSION'].includes(v.key?.toUpperCase()));
          if (mcVar && mcVar.value) {
            minecraftVersion = mcVar.value;
          }
        }
      } catch (err: any) {
        logger.warn(`Failed to parse server variables for compatibility checks: ${err.message}`);
      }
    }

    // 2. Parse Docker Image and Startup Command to detect software type
    const dockerImage = (server.dockerImage || '').toLowerCase();
    const startCmd = (server.StartCommand || '').toLowerCase();
    const imageName = (server.image?.name || '').toLowerCase();

    if (dockerImage.includes('velocity') || startCmd.includes('velocity') || imageName.includes('velocity')) {
      software = 'velocity';
    } else if (dockerImage.includes('bungee') || startCmd.includes('bungee') || imageName.includes('bungee')) {
      software = 'bungeecord';
    } else if (dockerImage.includes('waterfall') || startCmd.includes('waterfall') || imageName.includes('waterfall')) {
      software = 'waterfall';
    } else if (dockerImage.includes('folia') || startCmd.includes('folia') || imageName.includes('folia')) {
      software = 'folia';
    } else if (dockerImage.includes('purpur') || startCmd.includes('purpur') || imageName.includes('purpur')) {
      software = 'purpur';
    } else if (dockerImage.includes('fabric') || startCmd.includes('fabric') || imageName.includes('fabric')) {
      software = 'fabric';
    } else if (dockerImage.includes('forge') || startCmd.includes('forge') || imageName.includes('forge')) {
      software = 'forge';
    } else if (dockerImage.includes('neoforge') || startCmd.includes('neoforge') || imageName.includes('neoforge')) {
      software = 'neoforge';
    } else if (dockerImage.includes('sponge') || startCmd.includes('sponge') || imageName.includes('sponge')) {
      software = 'sponge';
    } else if (dockerImage.includes('spigot') || startCmd.includes('spigot') || imageName.includes('spigot')) {
      software = 'spigot';
    }

    // 3. Resolve Java Version from Docker Image tags
    const javaTagMatch = dockerImage.match(/java:?(\d+)/i) || dockerImage.match(/:(\d+)/);
    if (javaTagMatch && javaTagMatch[1]) {
      javaVersion = parseInt(javaTagMatch[1], 10);
    }

    return {
      minecraftVersion,
      software,
      javaVersion
    };
  }

  /**
   * Validates if a plugin is compatible with the resolved server environment.
   * Returns validation result and warnings if any.
   */
  public static validateCompatibility(
    pluginVersions: string[], // e.g. ['1.20', '1.20.1', '1.20.2', '1.20.4']
    pluginPlatforms: string[], // e.g. ['spigot', 'paper', 'purpur']
    serverEnv: ServerEnvironmentInfo
  ): { compatible: boolean; reason?: string; isWarning: boolean } {
    // 1. Proxy vs Backend Separation Enforcement
    const isProxyServer = ['velocity', 'bungeecord', 'waterfall'].includes(serverEnv.software);
    const isProxyPlugin = pluginPlatforms.some(p => ['velocity', 'bungeecord', 'waterfall', 'proxy'].includes(p.toLowerCase()));

    if (isProxyServer && !isProxyPlugin) {
      return {
        compatible: false,
        isWarning: false,
        reason: `Cannot install backend plugin on a proxy server running ${serverEnv.software}.`
      };
    }

    if (!isProxyServer && isProxyPlugin && !pluginPlatforms.some(p => ['paper', 'spigot', 'purpur', 'folia'].includes(p.toLowerCase()))) {
      return {
        compatible: false,
        isWarning: false,
        reason: `Cannot install proxy plugin (${pluginPlatforms.join(', ')}) on a backend server running ${serverEnv.software}.`
      };
    }

    // 2. Server Software Compatibility Check
    const isPlatformSupported = pluginPlatforms.length === 0 || pluginPlatforms.some(platform => {
      const p = platform.toLowerCase();
      // Purpur/Folia can run paper/spigot plugins.
      if (serverEnv.software === 'purpur') return ['purpur', 'paper', 'spigot', 'bukkit'].includes(p);
      if (serverEnv.software === 'folia') return ['folia', 'paper', 'spigot', 'bukkit'].includes(p);
      if (serverEnv.software === 'paper') return ['paper', 'spigot', 'bukkit'].includes(p);
      if (serverEnv.software === 'spigot') return ['spigot', 'bukkit'].includes(p);
      return p === serverEnv.software;
    });

    if (!isPlatformSupported) {
      return {
        compatible: false,
        isWarning: true,
        reason: `Plugin lists platforms [${pluginPlatforms.join(', ')}], which may not support server software: ${serverEnv.software}.`
      };
    }

    // 3. Minecraft Version Compatibility Check
    // Handle cases where version list is empty (assume wildcard/compatible)
    if (pluginVersions.length > 0) {
      const cleanMcVer = serverEnv.minecraftVersion.trim();
      const exactMatch = pluginVersions.includes(cleanMcVer);
      
      // Simple range check helper: e.g. if plugin supports "1.20", and server is "1.20.4"
      const prefixMatch = pluginVersions.some(v => cleanMcVer.startsWith(v) || v.startsWith(cleanMcVer.split('.')[0] + '.' + cleanMcVer.split('.')[1]));

      if (!exactMatch && !prefixMatch) {
        return {
          compatible: false,
          isWarning: true,
          reason: `Plugin is built for Minecraft versions [${pluginVersions.slice(0, 5).join(', ')}...], but server is running ${serverEnv.minecraftVersion}.`
        };
      }
    }

    return {
      compatible: true,
      isWarning: false
    };
  }
}
