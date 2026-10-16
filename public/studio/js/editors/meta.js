import { html } from '../../../js/ui/components.js';
import { DslEditor } from './dsl.js';
export function MetaEditor(props) { return html`<${DslEditor} ...${props} meta=${true} />`; }
export default { id: 'meta', Component: MetaEditor };
