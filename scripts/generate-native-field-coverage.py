#!/usr/bin/env python3
"""Generate per-attribute coverage identifiers in nativeFieldMap.json.

Mirrors curated alias coverage only (same basis as getMappedSourceFields):
for each platform/task, every sfccSystem id gets:
  { "status": "mapped"|"pending", "source": "<sourceField>"|null }

Identity matches (source name == SFCC id) are runtime-only and are NOT marked
mapped here unless an explicit alias exists — otherwise every system id would
look "covered".
"""
import json
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'cartridges' / 'bm_accelerator' / 'cartridge' / 'scripts' / 'migration' / 'config' / 'nativeFieldMap.json'


def load():
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=OrderedDict)


def canonical_system_index(system_ids):
    """lower → canonical sfccSystem id."""
    index = OrderedDict()
    for sid in system_ids or []:
        if sid is None or sid == '':
            continue
        index[str(sid).lower()] = sid
    return index


def alias_target(raw):
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw.get('sfccField')
    return raw


def build_coverage(data):
    sfcc = data['sfccSystem']
    aliases = data['aliases']
    coverage = OrderedDict()
    orphans = []

    for platform, tasks in aliases.items():
        plat = OrderedDict()
        handled_tasks = set()
        for task, alias_map in tasks.items():
            handled_tasks.add(task)
            system = list(sfcc.get(task, []))
            system_index = canonical_system_index(system)

            # canonical sfccField → first source field (1:1)
            by_sfcc = OrderedDict()
            for src, tgt in (alias_map or {}).items():
                field = alias_target(tgt)
                if field is None or field == '':
                    continue
                canon = system_index.get(str(field).lower())
                if not canon:
                    orphans.append((platform, task, src, field))
                    continue
                if canon not in by_sfcc:
                    by_sfcc[canon] = src

            attrs = OrderedDict()
            mapped_count = 0
            pending_count = 0
            for sid in system:
                source = by_sfcc.get(sid)
                if source:
                    attrs[sid] = OrderedDict([
                        ('status', 'mapped'),
                        ('source', source),
                    ])
                    mapped_count += 1
                else:
                    attrs[sid] = OrderedDict([
                        ('status', 'pending'),
                        ('source', None),
                    ])
                    pending_count += 1

            plat[task] = OrderedDict([
                ('attributes', attrs),
                ('mappedCount', mapped_count),
                ('pendingCount', pending_count),
                ('sfccSystemCount', len(system)),
            ])

        # Tasks present in sfccSystem but with no aliases for this platform
        for task in sfcc:
            if task in handled_tasks:
                continue
            system = list(sfcc[task])
            attrs = OrderedDict()
            for sid in system:
                attrs[sid] = OrderedDict([
                    ('status', 'pending'),
                    ('source', None),
                ])
            plat[task] = OrderedDict([
                ('attributes', attrs),
                ('mappedCount', 0),
                ('pendingCount', len(system)),
                ('sfccSystemCount', len(system)),
            ])
        coverage[platform] = plat

    return coverage, orphans


def main():
    if not path.is_file():
        print('ERROR: nativeFieldMap.json not found at', path, file=sys.stderr)
        sys.exit(1)

    data = load()
    coverage, orphans = build_coverage(data)
    data['coverage'] = coverage
    path.write_text(json.dumps(data, indent=4) + '\n', encoding='utf-8')

    print('Wrote coverage ->', path.relative_to(ROOT))
    if orphans:
        print('WARN: %d alias target(s) not in sfccSystem (ignored):' % len(orphans))
        for platform, task, src, field in orphans[:20]:
            print('  %s/%s  %s → %s' % (platform, task, src, field))
        if len(orphans) > 20:
            print('  … +%d more' % (len(orphans) - 20))

    print('Summary (mapped / pending / total):')
    for platform, tasks in coverage.items():
        for task, info in tasks.items():
            print('  %s/%s: %s / %s / %s' % (
                platform, task,
                info['mappedCount'], info['pendingCount'], info['sfccSystemCount']
            ))


if __name__ == '__main__':
    main()
