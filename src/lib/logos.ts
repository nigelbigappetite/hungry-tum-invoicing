/** Public paths for logos (files in /public). Use in img src. */
export const LOGOS = {
  app: '/Hungry%20Tum%20Logo.png',
  brands: {
    'Wing Shack': '/Wing%20Shack%20logo%201080x1080.png',
    'SMSH BN': '/smsh%20bn%20logo%20rnd.png',
    'Eggs n Stuff': '/Eggs%20n%20Stuff%20logo.png',
  } as Record<string, string>,
  platforms: {
    deliveroo: '/deliveroo%20logo.png',
    ubereats: '/uber%20eats%20logo.png',
    justeat: '/just%20eat%20logo.png',
    slerp: '/Wing%20Shack%20logo%201080x1080.png', // Wing Shack Co as Slerp asset
  } as Record<string, string>,
} as const;

export function getBrandLogo(brand: string): string {
  return LOGOS.brands[brand] ?? '';
}

export function getPlatformLogo(platform: string): string {
  return LOGOS.platforms[platform] ?? '';
}
