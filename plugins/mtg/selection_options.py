"""Shared validation for CLI and GUI printing preferences."""
from .common import ScryfallLanguage

BOOLEAN_OPTIONS = ('ignore_set_and_collector_number', 'prefer_older_sets', 'prefer_showcase',
                   'prefer_extra_art', 'prefer_ub', 'ignore_ub', 'tokens')
LIST_OPTIONS = ('prefer_set', 'ignore_set', 'prefer_lang')

def validate_options(value=None):
    value = value or {}
    if not isinstance(value, dict) or set(value) - set(BOOLEAN_OPTIONS + LIST_OPTIONS):
        raise ValueError('Unknown MTG preference')
    result = {}
    for key in BOOLEAN_OPTIONS:
        option = value.get(key, False)
        if not isinstance(option, bool):
            raise ValueError(f'{key} must be true or false')
        result[key] = option
    for key in LIST_OPTIONS:
        options = value.get(key, [])
        if not isinstance(options, (tuple, list)) or len(options) > 100:
            raise ValueError(f'{key} must be an ordered list')
        if any(not isinstance(item, str) or not item.strip() or len(item) > 30 for item in options):
            raise ValueError(f'Invalid {key}')
        result[key] = list(dict.fromkeys(item.strip().lower() for item in options))
    for lang in result['prefer_lang']:
        ScryfallLanguage(lang)
    if result['prefer_ub'] and result['ignore_ub']:
        raise ValueError('Choose either prefer or exclude Universes Beyond')
    return result
