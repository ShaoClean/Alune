import { createContext, useContext } from 'react';
export interface UIAppearance {
  theme: 'light' | 'dark';
  reduceMotion: boolean;
}
export const UIAppearanceContext = createContext<UIAppearance>({
  theme: 'light',
  reduceMotion: false,
});
export const useUIAppearance = () => useContext(UIAppearanceContext);
