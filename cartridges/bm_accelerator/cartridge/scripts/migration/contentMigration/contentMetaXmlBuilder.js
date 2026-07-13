'use strict';

/**
 * Build SFCC metadata IMPEX for Amplience Content custom attributes.
 * Import this before the library XML so attributes exist in BM.
 * Namespace: http://www.demandware.com/xml/impex/metadata/2006-10-31
 */

var NS_METADATA = 'http://www.demandware.com/xml/impex/metadata/2006-10-31';

var ATTRS = [
    { id: 'amplienceDeliveryKey',       name: 'Amplience Delivery Key',       type: 'string' },
    { id: 'amplienceContentId',         name: 'Amplience Content ID',         type: 'string' },
    { id: 'amplienceWidgetType',        name: 'Amplience Widget Type',        type: 'string' },
    { id: 'amplienceSchema',            name: 'Amplience Schema',             type: 'string' },
    { id: 'amplienceWidgetAttributes',  name: 'Amplience Widget Attributes',  type: 'text' },
    { id: 'amplienceImageUrl',          name: 'Amplience Image URL',          type: 'string' }
];

/**
 * @returns {string} metadata XML
 */
function buildMetaXml() {
    var lines = [];
    var i;

    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<metadata xmlns="' + NS_METADATA + '">');
    lines.push('  <type-extension type-id="Content">');
    lines.push('    <custom-attribute-definitions>');

    for (i = 0; i < ATTRS.length; i++) {
        var a = ATTRS[i];
        lines.push('      <attribute-definition attribute-id="' + a.id + '">');
        lines.push('        <display-name xml:lang="x-default">' + a.name + '</display-name>');
        lines.push('        <description xml:lang="x-default">Migrated Amplience CMS field</description>');
        lines.push('        <type>' + a.type + '</type>');
        lines.push('        <localizable-flag>false</localizable-flag>');
        lines.push('        <mandatory-flag>false</mandatory-flag>');
        lines.push('        <externally-managed-flag>false</externally-managed-flag>');
        lines.push('      </attribute-definition>');
    }

    lines.push('    </custom-attribute-definitions>');
    lines.push('    <group-definitions>');
    lines.push('      <attribute-group group-id="Amplience">');
    lines.push('        <display-name xml:lang="x-default">Amplience</display-name>');
    for (i = 0; i < ATTRS.length; i++) {
        lines.push('        <attribute attribute-id="' + ATTRS[i].id + '"/>');
    }
    lines.push('      </attribute-group>');
    lines.push('    </group-definitions>');
    lines.push('  </type-extension>');
    lines.push('</metadata>');

    return lines.join('\n');
}

module.exports = {
    NS_METADATA:  NS_METADATA,
    ATTRS:        ATTRS,
    buildMetaXml: buildMetaXml
};
