type CorePermission =
  | 'server.*'
  | 'server.view'
  | 'server.start'
  | 'server.stop'
  | 'server.restart'
  | 'server.files'
  | 'server.settings'
  | 'admin.*'
  | 'cynex.admin.addons.view'
  | 'cynex.admin.addons.toggle'
  | 'cynex.admin.addons.reload'
  | 'cynex.admin.addons.store'
  | 'cynex.admin.addons.install'
  | 'cynex.admin.analytics.view'
  | 'cynex.admin.apikeys.view'
  | 'cynex.admin.apikeys.create'
  | 'cynex.admin.apikeys.delete'
  | 'cynex.admin.apikeys.edit'
  | 'cynex.admin.api.docs.view'
  | 'cynex.admin.menu.main'
  | 'cynex.admin.overview.main'
  | 'cynex.admin.overview.checkForUpdates'
  | 'cynex.admin.overview.performUpdate'
  | 'cynex.admin.playerstats.view'
  | 'cynex.api.keys.view'
  | 'cynex.api.keys.create'
  | 'cynex.api.keys.delete'
  | 'cynex.api.keys.edit'
  | 'cynex.api.servers.read'
  | 'cynex.api.servers.create'
  | 'cynex.api.servers.update'
  | 'cynex.api.servers.delete'
  | 'cynex.api.users.read'
  | 'cynex.api.users.create'
  | 'cynex.api.users.update'
  | 'cynex.api.users.delete'
  | 'cynex.api.nodes.read'
  | 'cynex.api.nodes.create'
  | 'cynex.api.nodes.update'
  | 'cynex.api.nodes.delete'
  | 'cynex.api.settings.read'
  | 'cynex.api.settings.update';

export type Permission = CorePermission | `addon.${string}`;

const permissions: Permission[] = [];
const addonPermissionRegistry = new Map<string, string[]>();

export function registerPermission(permission: Permission): void {
  if (!permissions.includes(permission)) {
    permissions.push(permission);
  }
}

export function registerAddonPermission(addonSlug: string, permission: string): boolean {
  const expectedNs = `addon.${addonSlug}.`;
  if (!permission.startsWith(expectedNs)) {
    logger.warn(`Addon "${addonSlug}" tried to register permission outside its namespace: "${permission}"`);
    return false;
  }

  const typed = permission as Permission;
  if (!permissions.includes(typed)) {
    permissions.push(typed);
  }

  const existing = addonPermissionRegistry.get(addonSlug) ?? [];
  if (!existing.includes(permission)) {
    existing.push(permission);
    addonPermissionRegistry.set(addonSlug, existing);
  }

  return true;
}

export function clearAddonPermissions(addonSlug: string): void {
  const perms = addonPermissionRegistry.get(addonSlug);
  if (!perms) return;

  for (const perm of perms) {
    const idx = permissions.indexOf(perm as Permission);
    if (idx !== -1) permissions.splice(idx, 1);
  }

  addonPermissionRegistry.delete(addonSlug);
}

export function hasPermission(userPerms: Permission[], required: Permission): boolean {
  return userPerms.some((perm) => {
    if (perm === required) return true;
    if (perm.endsWith('.*')) {
      const base = perm.slice(0, -2);
      return required.startsWith(`${base}.`);
    }
    return false;
  });
}

import logger from './logger';

registerPermission('cynex.api.keys.view');
registerPermission('cynex.api.keys.create');
registerPermission('cynex.api.keys.delete');
registerPermission('cynex.api.keys.edit');

registerPermission('cynex.api.servers.read');
registerPermission('cynex.api.servers.create');
registerPermission('cynex.api.servers.update');
registerPermission('cynex.api.servers.delete');
registerPermission('cynex.api.users.read');
registerPermission('cynex.api.users.create');
registerPermission('cynex.api.users.update');
registerPermission('cynex.api.users.delete');
registerPermission('cynex.api.nodes.read');
registerPermission('cynex.api.nodes.create');
registerPermission('cynex.api.nodes.update');
registerPermission('cynex.api.nodes.delete');
registerPermission('cynex.api.settings.read');
registerPermission('cynex.api.settings.update');
registerPermission('cynex.admin.menu.main');

export default permissions;
