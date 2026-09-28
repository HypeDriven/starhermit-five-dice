// Five Dice — localized strings for the Graphics settings panel. The game has
// no general i18n system; only this panel is localized, picking the locale
// from navigator.language (exact match, then language family, then en-US).

const EN = {
  title: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Color grade',
  cat_antialias: 'Anti-aliasing', cat_reflections: 'Reflections', cat_particles: 'Embers', cat_detail: 'Table detail',
  off: 'Off', on: 'On', medium: 'Medium', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
  plain: 'Plain', detailed: 'Detailed',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable here, so the table renders without it.',
  no3d: '3D is unavailable in this browser; these settings apply when it is.',
  unknownGpu: 'unknown GPU',
  w_noShadows: 'no shadows', w_shadows: 'shadows', w_ao: 'ambient occlusion', w_aoHigh: 'full ambient occlusion',
  w_bloom: 'bloom', w_noAA: 'no anti-aliasing', w_reflections: 'reflections', w_particles: 'embers',
};

const STRINGS = {
  'en-US': EN,
  'en-GB': { ...EN, cat_grade: 'Colour grade' },
  'es-419': {
    title: 'Gráficos', quality: 'Calidad', auto: 'Automático (detectado: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Gradación de color',
    cat_antialias: 'Antialiasing', cat_reflections: 'Reflejos', cat_particles: 'Brasas', cat_detail: 'Detalle de la mesa',
    off: 'No', on: 'Sí', medium: 'Media', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Simple', detailed: 'Detallado',
    adaptive: 'Resolución adaptable', showFps: 'Mostrar cuadros por segundo',
    postFailed: 'El posprocesamiento no está disponible aquí; la mesa se muestra sin él.',
    no3d: 'El 3D no está disponible en este navegador; estos ajustes se aplicarán cuando lo esté.',
    unknownGpu: 'GPU desconocida',
    w_noShadows: 'sin sombras', w_shadows: 'sombras', w_ao: 'oclusión ambiental', w_aoHigh: 'oclusión ambiental completa',
    w_bloom: 'resplandor', w_noAA: 'sin antialiasing', w_reflections: 'reflejos', w_particles: 'brasas',
  },
  'es-ES': null, // filled below from es-419 with Spain wording
  'de-DE': {
    title: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
    renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Bloom', cat_grade: 'Farbkorrektur',
    cat_antialias: 'Kantenglättung', cat_reflections: 'Reflexionen', cat_particles: 'Glut', cat_detail: 'Tischdetails',
    off: 'Aus', on: 'An', medium: 'Mittel', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Einfach', detailed: 'Detailliert',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist hier nicht verfügbar; der Tisch wird ohne sie dargestellt.',
    no3d: '3D ist in diesem Browser nicht verfügbar; diese Einstellungen gelten, sobald es verfügbar ist.',
    unknownGpu: 'unbekannte GPU',
    w_noShadows: 'keine Schatten', w_shadows: 'Schatten', w_ao: 'Umgebungsverdeckung', w_aoHigh: 'volle Umgebungsverdeckung',
    w_bloom: 'Bloom', w_noAA: 'keine Kantenglättung', w_reflections: 'Reflexionen', w_particles: 'Glutfunken',
  },
  'fr-FR': {
    title: 'Graphismes', quality: 'Qualité', auto: 'Auto (détecté : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
    renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
    cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage des couleurs',
    cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_particles: 'Braises', cat_detail: 'Détail de la table',
    off: 'Désactivé', on: 'Activé', medium: 'Moyenne', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Simple', detailed: 'Détaillé',
    adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    postFailed: 'Le post-traitement est indisponible ici ; la table s’affiche sans lui.',
    no3d: 'La 3D est indisponible dans ce navigateur ; ces réglages s’appliqueront quand elle le sera.',
    unknownGpu: 'GPU inconnu',
    w_noShadows: 'sans ombres', w_shadows: 'ombres', w_ao: 'occlusion ambiante', w_aoHigh: 'occlusion ambiante complète',
    w_bloom: 'halo', w_noAA: 'sans anticrénelage', w_reflections: 'reflets', w_particles: 'braises',
  },
  'fr-CA': null, // filled below
  'pt-BR': {
    title: 'Gráficos', quality: 'Qualidade', auto: 'Automático (detectado: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão de ambiente', cat_bloom: 'Brilho', cat_grade: 'Correção de cor',
    cat_antialias: 'Antisserrilhado', cat_reflections: 'Reflexos', cat_particles: 'Brasas', cat_detail: 'Detalhe da mesa',
    off: 'Desligado', on: 'Ligado', medium: 'Média', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Simples', detailed: 'Detalhado',
    adaptive: 'Resolução adaptável', showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível aqui; a mesa é exibida sem ele.',
    no3d: 'O 3D não está disponível neste navegador; estas configurações valerão quando estiver.',
    unknownGpu: 'GPU desconhecida',
    w_noShadows: 'sem sombras', w_shadows: 'sombras', w_ao: 'oclusão de ambiente', w_aoHigh: 'oclusão de ambiente completa',
    w_bloom: 'brilho', w_noAA: 'sem antisserrilhado', w_reflections: 'reflexos', w_particles: 'brasas',
  },
  'it-IT': {
    title: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
    renderScale: 'Scala di rendering', fromPreset: 'Da preimpostazione ({tier})',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore',
    cat_antialias: 'Antialiasing', cat_reflections: 'Riflessi', cat_particles: 'Braci', cat_detail: 'Dettaglio del tavolo',
    off: 'No', on: 'Sì', medium: 'Media', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Semplice', detailed: 'Dettagliato',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame al secondo',
    postFailed: 'La post-elaborazione non è disponibile qui; il tavolo viene mostrato senza.',
    no3d: 'Il 3D non è disponibile in questo browser; queste impostazioni varranno quando lo sarà.',
    unknownGpu: 'GPU sconosciuta',
    w_noShadows: 'senza ombre', w_shadows: 'ombre', w_ao: 'occlusione ambientale', w_aoHigh: 'occlusione ambientale completa',
    w_bloom: 'bagliore', w_noAA: 'senza antialiasing', w_reflections: 'riflessi', w_particles: 'braci',
  },
};
STRINGS['es-ES'] = {
  ...STRINGS['es-419'],
  renderScale: 'Escala de renderizado', showFps: 'Mostrar fotogramas por segundo',
  adaptive: 'Resolución adaptativa', unknownGpu: 'GPU desconocida',
};
STRINGS['fr-CA'] = {
  ...STRINGS['fr-FR'],
  showFps: 'Afficher la fréquence d’images',
};

export const GFX_LOCALES = Object.keys(STRINGS);

const FAMILY = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

export function pickLocale(lang) {
  const l = String(lang || 'en-US');
  const exact = GFX_LOCALES.find((k) => k.toLowerCase() === l.toLowerCase());
  if (exact) return exact;
  return FAMILY[l.slice(0, 2).toLowerCase()] || 'en-US';
}

/** Translator for the Graphics panel: t(key, {tier}) with en-US fallback. */
export function gfxStrings(lang = (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) {
  const table = STRINGS[pickLocale(lang)];
  return (key, vars) => {
    let s = table[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}
