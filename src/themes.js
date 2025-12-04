export const THEMES = {
  neo: {
    id: 'neo',
    name: 'NeoMatrix',
    vars: {
      '--bg': '#000000',
      '--panel-bg': 'rgba(0,0,0,0.6)',
      '--accent': '#00ff66',
      '--accent-2': '#8ff',
      '--text': '#bfffbf',
      '--muted': '#071207',
      '--glow': '0 0 18px rgba(0,255,102,0.25)'
    }
  },
  hud: {
    id: 'hud',
    name: 'Cyber HUD',
    vars: {
      '--bg': '#001018',
      '--panel-bg': 'rgba(2,20,30,0.6)',
      '--accent': '#00d1ff',
      '--accent-2': '#66f2ff',
      '--text': '#dff6ff',
      '--muted': '#021018',
      '--glow': '0 0 14px rgba(0,209,255,0.2)'
    }
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal Pro',
    vars: {
      '--bg': '#0f1720',
      '--panel-bg': 'rgba(255,255,255,0.03)',
      '--accent': '#7dd3fc',
      '--accent-2': '#bfefff',
      '--text': '#e6eef7',
      '--muted': '#0b1220',
      '--glow': 'none'
    }
  },
  bladerunner: {
    id: 'bladerunner',
    name: 'BladeRunner',
    vars: {
      '--bg': '#0b0012',
      '--panel-bg': 'rgba(30,6,30,0.6)',
      '--accent': '#ff2dd2',
      '--accent-2': '#ff86f0',
      '--text': '#ffd6f2',
      '--muted': '#120016',
      '--glow': '0 0 16px rgba(255,45,210,0.2)'
    }
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra Black',
    vars: {
      '--bg': '#000000',
      '--panel-bg': 'rgba(10,10,10,0.7)',
      '--accent': '#8aff6b',
      '--accent-2': '#bfffbf',
      '--text': '#cfeedd',
      '--muted': '#040404',
      '--glow': '0 0 12px rgba(138,255,107,0.12)'
    }
  }
};


export function applyTheme(themeObj){
  const vars = themeObj.vars || {};
  Object.keys(vars).forEach(k => document.documentElement.style.setProperty(k, vars[k]));
}
