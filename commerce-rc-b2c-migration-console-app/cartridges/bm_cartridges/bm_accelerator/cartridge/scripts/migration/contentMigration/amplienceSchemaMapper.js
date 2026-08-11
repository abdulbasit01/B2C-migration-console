'use strict';

var SFCC_COMPONENTS = [
    { id: 'mainBanner',        label: 'Main Banner' },
    { id: 'campaignBanner',    label: 'Campaign Banner' },
    { id: 'editorialRichText', label: 'Editorial Rich Text' },
    { id: 'imageAndText',      label: 'Image and Text' },
    { id: 'amplienceWidget',   label: 'Amplience Widget (generic)' }
];

function countSchemaFields(contentType) {
    var schema = contentType.schema || contentType.body || {};
    var props  = schema.properties || {};
    return Object.keys(props).length;
}

/**
 * Suggest SFCC Page Designer component for an Amplience content type.
 * @param {Object} contentType
 * @returns {{ component: string, componentLabel: string, fieldCount: number }}
 */
function mapContentType(contentType) {
    var schemaUri = String(contentType.schemaUri || contentType.uri || '').toLowerCase();
    var label     = String(contentType.label || contentType.name || '').toLowerCase();
    var combined  = schemaUri + ' ' + label;
    var component = 'amplienceWidget';

    if (combined.indexOf('hero') >= 0 || combined.indexOf('banner') >= 0) {
        component = combined.indexOf('hero') >= 0 ? 'mainBanner' : 'campaignBanner';
    } else if (combined.indexOf('rich') >= 0 || combined.indexOf('article') >= 0
        || combined.indexOf('editorial') >= 0 || combined.indexOf('text') >= 0) {
        component = 'editorialRichText';
    } else if (combined.indexOf('card') >= 0 || combined.indexOf('image') >= 0) {
        component = 'imageAndText';
    }

    var componentLabel = component;
    var ci;
    for (ci = 0; ci < SFCC_COMPONENTS.length; ci++) {
        if (SFCC_COMPONENTS[ci].id === component) {
            componentLabel = SFCC_COMPONENTS[ci].label;
            break;
        }
    }

    return {
        component:      component,
        componentLabel: componentLabel,
        fieldCount:     countSchemaFields(contentType)
    };
}

module.exports = {
    SFCC_COMPONENTS: SFCC_COMPONENTS,
    mapContentType:  mapContentType
};
