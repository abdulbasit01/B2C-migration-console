'use strict';

var registry           = require('*/cartridge/scripts/migration/core/dataSourceRegistry');
var sourceAttrIds      = require('*/cartridge/scripts/migration/core/sourceAttrIds');
var shopifyMetafields  = require('*/cartridge/scripts/migration/core/shopifyMetafieldFields');
var ctpTypeMap         = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var shopifyTypeMap     = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap');
var sfccClient         = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder        = require('*/cartridge/scripts/migration/core/attrBuilder');
var nativeFieldMap     = require('*/cartridge/scripts/migration/config/nativeFieldMap');
var attrIdMapSession   = require('*/cartridge/scripts/migration/core/attrIdMapSession');
var openAiClient       = require('*/cartridge/scripts/migration/core/openAiClient');
var sfccTypeCompat     = require('*/cartridge/scripts/migration/core/sfccTypeCompat');

/**
 * Map SFCC system object type to nativeFieldMap task name.
 * @param {string} sfccObjectType
 * @returns {string}
 */
function taskNameForObject(sfccObjectType) {
    if (sfccObjectType === 'Profile') return 'Customer';
    return sfccObjectType;
}

/**
 * @param {string} platformId
 * @returns {Function}
 */
function getEnricher(platformId) {
    if (platformId === 'shopify' || platformId === 'bigcommerce') {
        var typeMap = platformId === 'bigcommerce'
            ? require('*/cartridge/scripts/migration/connectors/bigcommerce/bigcommerceTypeMap')
            : shopifyTypeMap;
        return function (entry) {
            var sourceType = entry.sourceType || entry.ctpType || 'single_line_text_field';
            var sfccType   = entry.sfccType
                || (typeMap.resolveMetafieldType
                    ? typeMap.resolveMetafieldType(sourceType)
                    : typeMap.resolveFieldType(sourceType))
                || 'string';
            var scope = attrBuilder.resolveAttributeScope(sourceType, entry.sfccObjectType);
            return {
                id:                entry.id,
                label:             entry.label,
                ctpType:           sourceType,
                sfccType:          sfccType,
                sfccTypeOptions:   [{ value: sfccType, label: sfccType }],
                sourceLocalizable: scope.sourceLocalizable,
                localizable:       scope.localizable,
                siteSpecific:      scope.siteSpecific,
                scope:             scope.scope
            };
        };
    }
    if (platformId === 'sap') {
        var sapTypeMap = require('*/cartridge/scripts/migration/connectors/sap/sapTypeMap');
        return function (entry) {
            var sourceType = entry.sourceType || entry.ctpType || 'java.lang.String';
            var sfccType = entry.sfccType || sapTypeMap.resolveAttributeType(sourceType) || 'string';
            var scope = attrBuilder.resolveAttributeScope(sourceType, entry.sfccObjectType);
            return {
                id:                entry.id,
                label:             entry.label,
                ctpType:           sourceType,
                sfccType:          sfccType,
                sfccTypeOptions:   [{ value: sfccType, label: sfccType }],
                sourceLocalizable: scope.sourceLocalizable,
                localizable:       scope.localizable,
                siteSpecific:      scope.siteSpecific,
                scope:             scope.scope
            };
        };
    }
    return ctpTypeMap.enrichMissingAttribute;
}

/**
 * Normalize a field descriptor to { sfccId, label, sourceType, sourceKey }.
 * @param {Object} field
 * @param {string} platformId
 * @returns {{ sfccId: string, label: string, sourceType: string, sourceKey: string }}
 */
function normalizeField(field, platformId) {
    var sourceType = field.sourceType || field.ctpType || 'String';
    var sourceKey  = field.sourceKey || field.name || field.id || field.sfccId || '';
    var sfccId     = field.sfccId || field.id || field.name;
    if (!field.sfccId && field.name && (platformId === 'shopify' || platformId === 'bigcommerce')) {
        sfccId = sourceAttrIds.toAttrId(field.name, platformId);
    } else if (!field.sfccId && field.name && platformId !== 'shopify' && platformId !== 'bigcommerce') {
        sfccId = field.name;
    }
    sfccId = sourceAttrIds.remapCamelAttrId(sfccId, platformId);
    return {
        sfccId:     sfccId,
        label:      field.label || sfccId,
        sourceType: sourceType,
        sourceKey:  String(sourceKey || sfccId)
    };
}

/**
 * Build system-attr list and id lookup from OCAPI definitions.
 * @param {Array} allAttrs
 * @returns {{ systemAttrs: Array, systemIds: Object, systemIdsLower: Object, systemTypes: Object, existingIds: Object, existingIdsLower: Object }}
 */
function indexAttrs(allAttrs) {
    var systemAttrs = [];
    var systemIds   = {};
    var systemIdsLower = {};
    var systemTypes = {};
    var valueTypes = {};
    var valueTypesLower = {};
    var existingIds = {};
    var existingIdsLower = {};
    var i;
    for (i = 0; i < (allAttrs || []).length; i++) {
        var a = allAttrs[i];
        existingIds[a.id] = true;
        existingIdsLower[String(a.id).toLowerCase()] = a.id;
        if (a.valueType) {
            valueTypes[a.id] = String(a.valueType);
            valueTypesLower[String(a.id).toLowerCase()] = String(a.valueType);
        }
        if (a.system) {
            systemAttrs.push(a);
            systemIds[a.id] = true;
            systemIdsLower[String(a.id).toLowerCase()] = a.id;
            if (a.valueType) {
                systemTypes[a.id] = String(a.valueType);
            }
        }
    }
    return {
        systemAttrs: systemAttrs,
        systemIds: systemIds,
        systemIdsLower: systemIdsLower,
        systemTypes: systemTypes,
        valueTypes: valueTypes,
        valueTypesLower: valueTypesLower,
        existingIds: existingIds,
        existingIdsLower: existingIdsLower
    };
}

/**
 * @param {string} sid
 * @param {Object} indexed
 * @param {string} [taskName]
 * @returns {string}
 */
function lookupSystemValueType(sid, indexed, taskName) {
    if (sid && indexed) {
        if (indexed.valueTypes && indexed.valueTypes[sid]) {
            return indexed.valueTypes[sid];
        }
        var lower = String(sid).toLowerCase();
        if (indexed.valueTypesLower && indexed.valueTypesLower[lower]) {
            return indexed.valueTypesLower[lower];
        }
        if (indexed.systemTypes && indexed.systemTypes[sid]) {
            return indexed.systemTypes[sid];
        }
        var canon = indexed.systemIdsLower
            ? indexed.systemIdsLower[lower]
            : '';
        if (canon && indexed.systemTypes && indexed.systemTypes[canon]) {
            return indexed.systemTypes[canon];
        }
    }
    return nativeFieldMap.getSystemValueType(taskName, sid) || '';
}

/**
 * Resolve an attribute id against a case-insensitive lookup map.
 * @param {string} attrId
 * @param {Object} exactIds - id -> true
 * @param {Object} lowerToCanonical - lowercase id -> canonical id
 * @returns {string} canonical id if found, else ''
 */
function resolveExistingId(attrId, exactIds, lowerToCanonical) {
    if (!attrId) return '';
    if (exactIds[attrId]) return attrId;
    var canon = lowerToCanonical[String(attrId).toLowerCase()];
    return canon || '';
}

/**
 * Classify source fields into mapped (SFCC system) vs missing (create candidates).
 * Auto-persists mapped remaps into attrIdMapSession when moduleKey is provided.
 *
 * @param {Object} opts
 * @param {string} opts.sfccObjectType
 * @param {string} [opts.taskName] - nativeFieldMap task (defaults from object type)
 * @param {string} [opts.moduleKey] - attrIdMapSession module key
 * @param {Array}  [opts.fields] - explicit field list; if omitted, loads via CT/Shopify paths
 * @param {Function} [opts.getCtpFieldsFn]
 * @param {Function} [opts.getExtraFieldsFn]
 * @param {Object.<string, string>} [opts.attrIdMap]
 * @returns {{ mapped: Array, missing: Array, suggested: Array, coveragePending: Array, skipped: Array, aiStatus: string, aiMessage: string }}
 */
function classifyFields(opts) {
    opts = opts || {};
    var platformId  = registry.getPlatformId();
    var group       = sourceAttrIds.getAttrGroup(platformId);
    var enrich      = getEnricher(platformId);
    var sfccToken   = sfccClient.getSFCCToken();
    var sfccObjectType = opts.sfccObjectType;
    var taskName    = opts.taskName || taskNameForObject(sfccObjectType);
    var moduleKey   = opts.moduleKey || '';
    var allAttrs    = sfccClient.getAttributeDefinitions(sfccToken, sfccObjectType);
    var indexed     = indexAttrs(allAttrs);
    var existingIds = indexed.existingIds;
    var existingIdsLower = indexed.existingIdsLower;
    var systemIds   = indexed.systemIds;
    var systemIdsLower = indexed.systemIdsLower;
    var map         = opts.attrIdMap && typeof opts.attrIdMap === 'object'
        ? opts.attrIdMap
        : (moduleKey ? attrIdMapSession.read(moduleKey) : {});
    var mapped      = [];
    var missing     = [];
    var autoMapped  = [];
    var seen        = {};
    var fields      = opts.fields || [];
    var i;
    var norm;
    var id;
    var resolvedId;
    var rule;
    var sourceKey;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, group.id, group.name);
    } catch (ge) {}

    if (!opts.fields) {
        fields = [];
        if (platformId === 'shopify') {
            fields = shopifyMetafields.fieldsForSfccObject(sfccObjectType);
        } else if (platformId === 'bigcommerce' || platformId === 'sap') {
            fields = [];
        } else if (opts.getCtpFieldsFn) {
            fields = opts.getCtpFieldsFn() || [];
        }
        if (opts.getExtraFieldsFn) {
            var extra = opts.getExtraFieldsFn(platformId) || [];
            for (i = 0; i < extra.length; i++) {
                fields.push(extra[i]);
            }
        }
        // Surface curated system-field maps (email->email, title->name, ...)
        var mapFields = nativeFieldMap.getMappedSourceFields(
            platformId === 'commercetools' ? 'commercetools' : platformId,
            taskName
        );
        for (i = 0; i < mapFields.length; i++) {
            fields.push(mapFields[i]);
        }
    }

    for (i = 0; i < fields.length; i++) {
        norm = normalizeField(fields[i], platformId);
        id   = norm.sfccId;
        sourceKey = norm.sourceKey;
        if (!id || seen[id]) continue;
        seen[id] = true;

        // Curated skipped[] keys are informational only — never create candidates
        if (nativeFieldMap.isExplicitSkip(
            platformId === 'commercetools' ? 'commercetools' : platformId,
            taskName,
            sourceKey
        ) || nativeFieldMap.isExplicitSkip(platformId, taskName, id)) {
            continue;
        }

        // Alias + identity only (no fuzzy detector). Fuzzy token matches invent
        // system maps (e.g. "productDescription" -> shortDescription) outside rules.
        rule = nativeFieldMap.getRule(
            platformId === 'commercetools' ? 'commercetools' : platformId,
            taskName,
            sourceKey
        );
        if (!rule && sourceKey !== id) {
            rule = nativeFieldMap.getRule(platformId, taskName, id);
        }

        if (rule && nativeFieldMap.isMapAction(rule.action) && rule.sfccField) {
            // Prefer live OCAPI system flag; fall back to dump-backed sfccSystem catalog.
            // Order/Profile OCAPI payloads sometimes omit system:true, which previously
            // dropped curated aliases and showed a false "all attributes exist" empty state.
            var systemCanon = resolveExistingId(rule.sfccField, systemIds, systemIdsLower)
                || nativeFieldMap.resolveSystemId(taskName, rule.sfccField);
            if (systemCanon) {
                mapped.push({
                    id:         sourceKey || id,
                    label:      norm.label || sourceKey || id,
                    sourceType: norm.sourceType,
                    ctpType:    norm.sourceType,
                    sfccField:  systemCanon,
                    note:       rule.note || '',
                    status:     'mapped'
                });
                autoMapped.push({ id: systemCanon, canonicalId: sourceKey || id });
                if (sourceKey && sourceKey !== id) {
                    autoMapped.push({ id: systemCanon, canonicalId: id });
                }
                continue;
            }
        }

        // custom_attr rule: prefer mapped custom id as the create/existence target
        if (rule && rule.action === 'custom_attr' && rule.sfccField) {
            id = rule.sfccField;
        }

        // Visit session remaps (create-rename or AI Use mapping).
        // Remaps onto SFCC *system* fields must NOT become "already exists" rows —
        // those stay create candidates / AI-selectable. Export still uses the session map.
        // Remaps onto custom ids still drive existence checks (create-as-rename).
        var sessionRemap = '';
        if (map[sourceKey] && String(map[sourceKey]).trim()) {
            sessionRemap = String(map[sourceKey]).trim();
        } else if (map[id] && String(map[id]).trim()) {
            sessionRemap = String(map[id]).trim();
        }

        var sessionSystemCanon = '';
        if (sessionRemap) {
            sessionSystemCanon = resolveExistingId(sessionRemap, systemIds, systemIdsLower)
                || nativeFieldMap.resolveSystemId(taskName, sessionRemap)
                || '';
        }

        if (sessionSystemCanon) {
            // Keep as create candidate; UI hydrates AI "already mapped" from sessionSystemMaps
            missing.push(enrich({
                id:             id,
                label:          norm.label,
                sourceType:     norm.sourceType,
                ctpType:        norm.sourceType,
                sfccObjectType: sfccObjectType
            }));
            continue;
        }

        resolvedId = sessionRemap || id;

        var existingCanon = resolveExistingId(resolvedId, existingIds, existingIdsLower);
        if (existingCanon) {
            // Same attribute id (or custom rename target) already on SFCC — not an AI system map
            mapped.push({
                id:         id,
                label:      norm.label,
                sourceType: norm.sourceType,
                ctpType:    norm.sourceType,
                sfccField:  existingCanon,
                note:       systemIds[existingCanon] || systemIdsLower[String(existingCanon).toLowerCase()]
                    ? 'Already exists as SFCC system field.'
                    : 'Already exists in SFCC.',
                status:     'exists'
            });
            if (id !== existingCanon) {
                autoMapped.push({ id: existingCanon, canonicalId: id });
            }
            try {
                sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, group.id, existingCanon);
            } catch (age) {}
            continue;
        }

        missing.push(enrich({
            id:             id,
            label:          norm.label,
            sourceType:     norm.sourceType,
            ctpType:        norm.sourceType,
            sfccObjectType: sfccObjectType
        }));
    }

    // Build exclusive session→system maps for AI UI (one SFCC system field → one source).
    // Drop duplicate claims so two sources cannot both keep longDescription.
    var sessionSystemMaps = [];
    var claimedSystem = {};
    var mapKeys = Object.keys(map || {});
    var mi;
    for (mi = 0; mi < mapKeys.length; mi++) {
        var srcKey = mapKeys[mi];
        var tgt = String(map[srcKey] || '').trim();
        if (!srcKey || !tgt || srcKey === tgt) continue;
        var sysCanon = resolveExistingId(tgt, systemIds, systemIdsLower)
            || nativeFieldMap.resolveSystemId(taskName, tgt)
            || '';
        if (!sysCanon) continue;
        if (claimedSystem[sysCanon]) {
            // Clear duplicate session claim so export/UI stay 1:1
            if (moduleKey) {
                try {
                    attrIdMapSession.removeMapping(moduleKey, srcKey);
                } catch (rmErr) { /* ignore */ }
            }
            continue;
        }
        claimedSystem[sysCanon] = srcKey;
        sessionSystemMaps.push({
            sourceId:  srcKey,
            sfccField: sysCanon
        });
    }

    if (moduleKey && autoMapped.length) {
        attrIdMapSession.saveFromAttrs(moduleKey, autoMapped);
    }

    // SFCC system attrs with no curated source yet (coverage pending).
    // Shown as map-to targets on 3.c create rows; not created from this check.
    // Exclude fields already claimed by curated maps, identity matches, or session maps.
    var coverageTaken = {};
    var ti;
    for (ti = 0; ti < mapped.length; ti++) {
        if (mapped[ti] && mapped[ti].sfccField) coverageTaken[mapped[ti].sfccField] = true;
    }
    var claimedKeys = Object.keys(claimedSystem);
    for (ti = 0; ti < claimedKeys.length; ti++) {
        coverageTaken[claimedKeys[ti]] = true;
    }

    var coveragePending = [];
    var cov = nativeFieldMap.getCoverage(
        platformId === 'commercetools' ? 'commercetools' : platformId,
        taskName
    );
    if (cov && cov.attributes) {
        var covIds = Object.keys(cov.attributes);
        var ci;
        for (ci = 0; ci < covIds.length; ci++) {
            var sid = covIds[ci];
            var info = cov.attributes[sid];
            if (info && info.status === 'pending' && !coverageTaken[sid]) {
                var valueType = lookupSystemValueType(sid, indexed, taskName);
                coveragePending.push({
                    id:        sid,
                    label:     sid,
                    status:    'pending',
                    source:    null,
                    valueType: valueType,
                    note:      'SFCC system field with no source mapping yet - not created from this check.'
                });
            }
        }
    }

    var anyTypedPending = false;
    for (ti = 0; ti < coveragePending.length; ti++) {
        if (coveragePending[ti] && coveragePending[ti].valueType) {
            anyTypedPending = true;
            break;
        }
    }
    sfccTypeCompat.attachMappableSystemFields(missing, coveragePending, anyTypedPending);

    // Source fields intentionally not created (structural / platform / migrate elsewhere)
    var skipped = nativeFieldMap.getSkippedFields(
        platformId === 'commercetools' ? 'commercetools' : platformId,
        taskName
    );

    // AI runs async from the UI after this response (status bar: Validating with AI...).
    // Do not call OpenAI here — keep Check Attributes fast and show progress client-side.
    var aiStatus = 'skipped';
    var aiMessage = '';
    if (missing.length && openAiClient.isConfigured()) {
        aiStatus = 'pending';
        aiMessage = 'Ready for AI validation';
    } else if (missing.length) {
        aiMessage = 'OpenAI suggestions disabled or API key missing';
    }

    return {
        mapped:             mapped,
        missing:            missing,
        suggested:          [],
        coveragePending:    coveragePending,
        skipped:            skipped,
        aiStatus:           aiStatus,
        aiMessage:          aiMessage,
        taskName:           taskName,
        sfccObjectType:     sfccObjectType,
        sessionSystemMaps:  sessionSystemMaps
    };
}

/**
 * @param {string} sfccObjectType
 * @param {Function} getCtpFieldsFn
 * @param {Function} [getExtraFieldsFn]
 * @param {Object.<string, string>} [attrIdMap]
 * @param {string} [moduleKey]
 * @param {string} [taskName]
 * @returns {{ mapped: Array, missing: Array }}
 */
function checkMissing(sfccObjectType, getCtpFieldsFn, getExtraFieldsFn, attrIdMap, moduleKey, taskName) {
    return classifyFields({
        sfccObjectType:  sfccObjectType,
        getCtpFieldsFn:  getCtpFieldsFn,
        getExtraFieldsFn: getExtraFieldsFn,
        attrIdMap:       attrIdMap,
        moduleKey:       moduleKey,
        taskName:        taskName
    });
}

/**
 * Create attribute definitions with exists/created/mapped result shape.
 * @param {string} sfccObjectType
 * @param {string} groupId
 * @param {string} groupName
 * @param {Array} attrs
 * @returns {{
 *   created: number,
 *   failed: number,
 *   alreadyExists: number,
 *   errors: Array,
 *   createdAttrs: Array,
 *   mappedAttrs: Array,
 *   results: Array
 * }}
 */
function createDefinitions(sfccObjectType, groupId, groupName, attrs) {
    var platformId  = registry.getPlatformId();
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, sfccObjectType);
    var created     = 0;
    var failed      = 0;
    var alreadyExists = 0;
    var errors      = [];
    var createdAttrs = [];
    var mappedAttrs  = [];
    var results      = [];
    var i;
    var attr;
    var attrId;
    var canonicalId;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, groupId, groupName);
    } catch (ge) {}

    for (i = 0; i < attrs.length; i++) {
        attr        = attrs[i];
        attrId      = sourceAttrIds.remapCamelAttrId(attr.id, platformId);
        canonicalId = attr.canonicalId || attr.sourceId || attr.id || attrId;

        if (!attrId) {
            failed++;
            if (errors.length < 5) errors.push('(empty): Attribute ID is required');
            results.push({
                id: '', canonicalId: canonicalId || '', status: 'error',
                message: 'Attribute ID is required'
            });
            continue;
        }

        if (existingIds[attrId]) {
            alreadyExists++;
            try {
                sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, groupId, attrId);
            } catch (age) {}
            mappedAttrs.push({ id: attrId, canonicalId: canonicalId });
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'exists',
                message: 'Already exists in SFCC'
            });
            continue;
        }

        try {
            var sourceType = attr.ctpType || attr.sourceType || '';
            var scope = attrBuilder.resolveAttributeScope(sourceType, sfccObjectType);
            var localizable = Object.prototype.hasOwnProperty.call(attr, 'localizable')
                ? !!attr.localizable
                : scope.localizable;
            if (!attrBuilder.supportsAttributeScope(sfccObjectType)) {
                localizable = false;
            }
            var def = attrBuilder.buildAttrDefinition(
                attrId,
                attr.sfccType || 'string',
                attr.label    || attrId,
                {
                    localizable:    localizable,
                    siteSpecific:   false,
                    sourceType:     sourceType,
                    sfccObjectType: sfccObjectType
                }
            );
            sfccClient.createAttributeDefinition(sfccToken, sfccObjectType, def);
            sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, groupId, attrId);
            existingIds[attrId] = true;
            created++;
            createdAttrs.push({ id: attrId, canonicalId: canonicalId });
            mappedAttrs.push({ id: attrId, canonicalId: canonicalId });
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'created',
                message: 'Created'
            });
        } catch (e) {
            failed++;
            var errMsg = e.message || String(e);
            if (errors.length < 5) errors.push(attrId + ': ' + errMsg);
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'error',
                message: errMsg
            });
        }
    }
    return {
        created:       created,
        failed:        failed,
        alreadyExists: alreadyExists,
        errors:        errors,
        createdAttrs:  createdAttrs,
        mappedAttrs:   mappedAttrs,
        results:       results
    };
}

/**
 * @param {string} sfccObjectType
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, alreadyExists: number, errors: Array, createdAttrs: Array, mappedAttrs: Array, results: Array }}
 */
function createAttributes(sfccObjectType, attrs) {
    var platformId = registry.getPlatformId();
    var group      = sourceAttrIds.getAttrGroup(platformId);
    return createDefinitions(sfccObjectType, group.id, group.name, attrs);
}

module.exports = {
    checkMissing:       checkMissing,
    classifyFields:     classifyFields,
    createAttributes:   createAttributes,
    createDefinitions:  createDefinitions,
    normalizeField:     normalizeField,
    taskNameForObject:  taskNameForObject
};
