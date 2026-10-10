// CSS property browser defaults - filter these out to reduce payload
const BROWSER_DEFAULTS = {
  display: 'inline',
  flexDirection: 'row',
  alignItems: 'normal',
  justifyContent: 'normal',
  gap: 'normal',
  padding: '0px',
  margin: '0px',
  fontSize: '16px',
  fontWeight: '400',
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  borderRadius: '0px',
  border: '0px none rgb(0, 0, 0)',
  boxShadow: 'none',
  position: 'static',
  overflow: 'visible',
  cursor: 'auto',
  opacity: '1',
  transform: 'none',
};

function diffFromDefaults(computedStyles) {
  const result = {};
  for (const [prop, value] of Object.entries(computedStyles)) {
    if (BROWSER_DEFAULTS[prop] !== value && value !== '' && value !== 'initial') {
      result[prop] = value;
    }
  }
  return result;
}

module.exports = { diffFromDefaults };
