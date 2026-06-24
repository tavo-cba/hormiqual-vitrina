import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './SearchSuggest.css';

const normalizeKeywords = (keywords) => {
    if (!keywords) return [];
    if (Array.isArray(keywords)) return keywords.filter(Boolean).map(String);
    return [String(keywords)];
};

const hasActionPermission = (actionMap) => {
    if (!actionMap || typeof actionMap !== 'object') return true;
    const values = Object.values(actionMap);
    if (!values.length) return true;
    return values.some(Boolean);
};

const SearchSuggest = ({
    items = [],
    onSelect,
    onSelectSecondary,
    autoFocus = false,
    className = '',
    canAccessRoute = () => true,
    getActions = () => ({}),
}) => {
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const accessibleItems = useMemo(
        () =>
            items.filter((item) => {
                if (!item?.ruta || !item?.titulo) return false;
                if (!canAccessRoute(item.ruta)) return false;
                return hasActionPermission(getActions(item.ruta));
            }),
        [items, canAccessRoute, getActions]
    );

    const suggestions = useMemo(() => {
        const term = query.trim().toLowerCase();
        if (!term) return [];

        return accessibleItems
            .filter((item) => {
                const keywordList = [item.titulo, item.ruta, ...normalizeKeywords(item.keywords)]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return keywordList.includes(term);
            })
            .slice(0, 10);
    }, [accessibleItems, query]);

    const handleSelect = (item) => {
        if (!item?.ruta) return;
        if (onSelect) {
            onSelect(item);
        } else {
            navigate(item.ruta);
        }
        setQuery('');
        setFocused(false);
        setHighlightedIndex(-1);
    };

    const handleSecondarySelect = (item, e) => {
        e.preventDefault();
        if (!item?.ruta) return;
        if (onSelectSecondary) {
            onSelectSecondary(item);
        }
        setQuery('');
        setFocused(false);
        setHighlightedIndex(-1);
    };

    const handleKeyDown = (e) => {
        if (!suggestions.length) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex((prev) =>
                    prev < suggestions.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex((prev) =>
                    prev > 0 ? prev - 1 : suggestions.length - 1
                );
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                    handleSelect(suggestions[highlightedIndex]);
                }
                break;
            case 'Escape':
                setFocused(false);
                setHighlightedIndex(-1);
                break;
            default:
                break;
        }
    };

    useEffect(() => {
        setHighlightedIndex(-1);
    }, [query]);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [autoFocus]);

    return (
        <div
            className={`search-suggest ${className}`.trim()}
            onBlur={() => {
                setFocused(false);
                setHighlightedIndex(-1);
            }}
            onFocus={() => setFocused(true)}
        >
            <span className="search-suggest__icon">
                <i className="fa-solid fa-magnifying-glass" aria-hidden />
            </span>
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                ref={inputRef}
                className="search-bar search-suggest__input"
                placeholder="Buscar secciones..."
                aria-label="Buscar"
                aria-autocomplete="list"
                aria-expanded={focused && suggestions.length > 0}
            />

            {focused && suggestions.length > 0 && (
                <div className="search-suggest__dropdown">
                    <div className="search-suggest__list" ref={listRef} role="listbox">
                        {suggestions.map((item, index) => (
                            <button
                                type="button"
                                key={item.ruta}
                                className={`search-suggest__item ${index === highlightedIndex ? 'search-suggest__item--highlighted' : ''}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => handleSelect(item)}
                                onContextMenu={(e) => handleSecondarySelect(item, e)}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                role="option"
                                aria-selected={index === highlightedIndex}
                            >
                                <div className="search-suggest__item-icon">
                                    <i className="fa-solid fa-arrow-right" aria-hidden />
                                </div>
                                <div className="search-suggest__item-content">
                                    <div className="search-suggest__title">{item.titulo}</div>
                                    {item.parentPath && (
                                        <div className="search-suggest__subtitle">{item.parentPath}</div>
                                    )}
                                </div>
                                <div className="search-suggest__item-hint">
                                    <span className="search-suggest__hint-key">↵</span>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="search-suggest__footer">
                        <span><kbd>↑↓</kbd> navegar</span>
                        <span><kbd>↵</kbd> ir</span>
                        <span><kbd>clic derecho</kbd> abrir pestaña</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchSuggest;