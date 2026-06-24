import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useTabContext } from "../../context/TabContext";
import SearchSuggest from "../../common/SearchSuggest";
import { flattenMenusToIndex } from "../../utils/menuIndex";
import './TabBar.css';

const TabBar = ({ isHovered, menus, canAccessRoute, getActions }) => {
    const { tabs, activeTabId, closeTab, activateTab, reorderTabs, favorites, removeFavorite, openNewTab, openNavTab, navigateActive, reloadActiveTab, goBackActiveTab } = useTabContext();
    const tabListRef = useRef(null);
    const tabRefs = useRef({});
    const searchRef = useRef(null);
    const favoritesRef = useRef(null);
    const [showScrollIndicators, setShowScrollIndicators] = useState({ left: false, right: false });
    const [draggedTabId, setDraggedTabId] = useState(null);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dropTargetIndex, setDropTargetIndex] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [draggedTabRect, setDraggedTabRect] = useState(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [closingTabId, setClosingTabId] = useState(null);

    const offset = isHovered ? 240 : 40;
    const menuIndex = useMemo(() => flattenMenusToIndex(menus), [menus]);

    // Lookup ruta → parentPath para mostrar breadcrumb en favoritos
    const parentPathMap = useMemo(() => {
        const map = {};
        menuIndex.forEach(item => { if (item.ruta) map[item.ruta] = item.parentPath; });
        return map;
    }, [menuIndex]);

    // Solo tabs de navegación (no pinned/favoritos)
    const navTabs = useMemo(() => tabs.filter(t => t.type !== 'pinned'), [tabs]);

    useEffect(() => {
        if (!isSearchOpen) return undefined;

        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setIsSearchOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isSearchOpen]);

    // Close favorites dropdown on click outside
    useEffect(() => {
        if (!isFavoritesOpen) return undefined;

        const handleClickOutside = (event) => {
            if (favoritesRef.current && !favoritesRef.current.contains(event.target)) {
                setIsFavoritesOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isFavoritesOpen]);

    // Keyboard shortcut to open search (Ctrl+K or Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsSearchOpen(true);
            }
            if (e.key === 'Escape' && isSearchOpen) {
                setIsSearchOpen(false);
            }
            if (e.key === 'Escape' && isFavoritesOpen) {
                setIsFavoritesOpen(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isSearchOpen, isFavoritesOpen]);


    const updateScrollIndicators = useCallback(() => {
        const container = tabListRef.current;
        if (!container) return;

        const { scrollLeft, scrollWidth, clientWidth } = container;
        const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

        const overflowing = maxScrollLeft > 1;
        setIsOverflowing(overflowing);

        if (!overflowing) {
            setShowScrollIndicators({ left: false, right: false });
            return;
        }

        setShowScrollIndicators({
            left: scrollLeft > 1,
            right: scrollLeft < maxScrollLeft - 1,
        });
    }, []);

    useEffect(() => {
        const tabList = tabListRef.current;
        if (!tabList) return undefined;

        updateScrollIndicators();
        tabList.addEventListener('scroll', updateScrollIndicators);
        window.addEventListener('resize', updateScrollIndicators);

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateScrollIndicators)
            : null;
        resizeObserver?.observe(tabList);

        return () => {
            tabList.removeEventListener('scroll', updateScrollIndicators);
            window.removeEventListener('resize', updateScrollIndicators);
            resizeObserver?.disconnect();
        };
    }, [navTabs, updateScrollIndicators]);

    const handleScroll = (direction) => {
        if (tabListRef.current) {
            const scrollAmount = 200;
            tabListRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    const handleDragStart = (tabId, index) => (event) => {
        const tabElement = tabRefs.current[tabId];
        if (tabElement) {
            const rect = tabElement.getBoundingClientRect();
            setDraggedTabRect(rect);

            // Crear imagen de arrastre personalizada
            const dragImage = tabElement.cloneNode(true);
            dragImage.style.position = 'absolute';
            dragImage.style.top = '-9999px';
            dragImage.style.opacity = '0.85';
            dragImage.style.transform = 'rotate(-3deg)';
            dragImage.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)';
            document.body.appendChild(dragImage);

            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setDragImage(dragImage, rect.width / 2, rect.height / 2);

            setTimeout(() => document.body.removeChild(dragImage), 0);
        }

        event.dataTransfer.setData('text/plain', tabId);
        setDraggedTabId(tabId);
        setDraggedIndex(index);
        setIsDragging(true);
    };

    const handleDragOver = (index) => (event) => {
        event.preventDefault();
        if (!isDragging || index === draggedIndex) return;
        const draggedTab = navTabs.find(t => t.id === draggedTabId);
        const targetTab = navTabs[index];
        if (!draggedTab || !targetTab) {
            event.dataTransfer.dropEffect = 'none';
            return;
        }
        event.dataTransfer.dropEffect = 'move';
        setDropTargetIndex(index);
    };

    const handleDragEnter = (index) => (event) => {
        event.preventDefault();
        if (!isDragging || index === draggedIndex) return;
        const draggedTab = navTabs.find(t => t.id === draggedTabId);
        const targetTab = navTabs[index];
        if (!draggedTab || !targetTab) return;
        setDropTargetIndex(index);
    };

    const handleDrop = (targetIndex) => (event) => {
        event.preventDefault();
        event.stopPropagation();

        const finalIndex = targetIndex ?? dropTargetIndex;
        const targetTab = finalIndex !== null ? navTabs[finalIndex] : null;
        if (
            draggedTabId &&
            finalIndex !== null &&
            finalIndex !== draggedIndex &&
            targetTab
        ) {
            reorderTabs(draggedTabId, targetTab.id);
        }

        resetDragState();
    };

    const handleDragEnd = () => {
        resetDragState();
    };

    const handleContainerDragOver = (event) => {
        if (!isDragging) return;
        event.preventDefault();
    };

    const handleContainerDrop = (event) => {
        event.preventDefault();
        const targetTab = dropTargetIndex !== null ? navTabs[dropTargetIndex] : null;
        if (
            draggedTabId &&
            dropTargetIndex !== null &&
            dropTargetIndex !== draggedIndex &&
            targetTab
        ) {
            reorderTabs(draggedTabId, targetTab.id);
        }
        resetDragState();
    };

    const resetDragState = () => {
        setDraggedTabId(null);
        setDraggedIndex(null);
        setDropTargetIndex(null);
        setIsDragging(false);
        setDraggedTabRect(null);
    };

    const getTabTransform = (index) => {
        if (!isDragging || draggedIndex === null || dropTargetIndex === null) {
            return 'translateX(0)';
        }

        if (index === draggedIndex) {
            return 'translateX(0) scale(0.95)';
        }

        if (draggedIndex < dropTargetIndex) {
            if (index > draggedIndex && index <= dropTargetIndex) {
                const tabWidth = draggedTabRect?.width || 0;
                return `translateX(-${tabWidth + 6}px)`;
            }
        } else if (draggedIndex > dropTargetIndex) {
            if (index < draggedIndex && index >= dropTargetIndex) {
                const tabWidth = draggedTabRect?.width || 0;
                return `translateX(${tabWidth + 6}px)`;
            }
        }

        return 'translateX(0)';
    };

    // Click normal en buscador: navega dentro de la tab activa
    const handleSelect = (item) => {
        if (item?.ruta) {
            navigateActive(item.ruta, item.titulo);
            setIsSearchOpen(false);
        }
    };

    // Click derecho en buscador: abre como favorito
    const handleSelectSecondary = (item) => {
        if (item?.ruta) {
            openNewTab(item.ruta, item.titulo);
            setIsSearchOpen(false);
        }
    };

    // Cerrar pestaña con animación — medir ancho real y colapsar con inline style
    const [closingStyle, setClosingStyle] = useState(null);

    const handleCloseTab = useCallback((id) => {
        const el = tabRefs.current[id];

        // Activar la siguiente pestaña INMEDIATAMENTE (antes de la animación)
        if (activeTabId === id) {
            const navOnly = tabs.filter(t => t.type !== 'pinned' && t.id !== id);
            if (navOnly.length) {
                const closedNavIndex = tabs.filter(t => t.type !== 'pinned').findIndex(t => t.id === id);
                const next = navOnly[Math.min(closedNavIndex, navOnly.length - 1)];
                activateTab(next.id);
            }
        }

        if (!el) { closeTab(id); return; }

        const rect = el.getBoundingClientRect();
        // Paso 1: fijar width actual para poder animarla
        setClosingTabId(id);
        setClosingStyle({ width: rect.width, opacity: 1 });

        // Paso 2: en el next frame, colapsar a 0 (ancho/opacidad/padding).
        // El timer de remoción se programa ACÁ y no en t=0: el doble RAF
        // retrasa el inicio real de la transición ~2 frames, así que un
        // timeout arrancado en t=0 quitaría la pestaña del DOM antes de
        // terminar de colapsar y las vecinas pegarían un salto. Arrancando
        // el timer junto con la transición, espera siempre el colapso completo.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setClosingStyle({ width: 0, opacity: 0, paddingLeft: 0, paddingRight: 0 });
                setTimeout(() => {
                    closeTab(id);
                    setClosingTabId(null);
                    setClosingStyle(null);
                }, 230);
            });
        });
    }, [closeTab, activeTabId, tabs, activateTab]);

    // Click en un favorito: abrir nueva pestaña de navegación
    const handleFavoriteClick = (fav) => {
        openNewTab(fav.initialPath, fav.label);
        setIsFavoritesOpen(false);
    };

    return (
        <div
            className="tabbar"
            style={{ left: 0, width: '100%' }}
        >
            {/* Grupo izquierdo: Volver atrás + Recargar */}
            <div className="tabbar__actions-left">
                <button
                    className="tabbar__action-btn"
                    onClick={goBackActiveTab}
                    title="Volver atrás"
                    aria-label="Volver atrás"
                    disabled={!activeTabId}
                >
                    <i className="fa-solid fa-arrow-left" />
                </button>

                <button
                    className="tabbar__action-btn"
                    onClick={reloadActiveTab}
                    title="Recargar"
                    aria-label="Recargar pestaña"
                    disabled={!activeTabId}
                >
                    <i className="fa-solid fa-rotate-right" />
                </button>
            </div>

            <div className="tabbar__tabs">
                {showScrollIndicators.left && (
                    <button
                        className="tabbar__scroll-button tabbar__scroll-button--left"
                        onClick={() => handleScroll('left')}
                        aria-label="Scroll tabs left"
                    >
                        <i className="fa-solid fa-chevron-left" />
                    </button>
                )}

                <div
                    className="tabbar__container"
                    ref={tabListRef}
                    onDragOver={handleContainerDragOver}
                    onDrop={handleContainerDrop}
                >
                    {navTabs.length === 0 ? (
                        <div className="tabbar__empty"><strong>+</strong> para nueva pestaña · <i className="fa-solid fa-star" style={{ fontSize: '11px', color: '#d4a017' }} /> para ver favoritos</div>
                    ) : navTabs.map((tab, _mapIndex) => {
                        const index = navTabs.indexOf(tab);
                        const isActive = tab.id === activeTabId;
                        const isBeingDragged = tab.id === draggedTabId;
                        const isPlaceholder = isDragging && index === dropTargetIndex && !isBeingDragged;
                        const isClosing = tab.id === closingTabId;
                        const tabIcon = (tab.path === '/' ? 'fa-solid fa-home' : tab.icon) || 'fa-solid fa-file-lines';

                        return (
                            <div
                                key={tab.id}
                                ref={(el) => (tabRefs.current[tab.id] = el)}
                                className={[
                                    'tabbar__tab',
                                    isActive ? 'tabbar__tab--active' : '',
                                    isBeingDragged ? 'tabbar__tab--dragging' : '',
                                    isPlaceholder ? 'tabbar__tab--drop-placeholder' : '',
                                    isClosing ? 'tabbar__tab--closing' : '',
                                ].filter(Boolean).join(' ')}
                                onClick={() => !isClosing && activateTab(tab.id)}
                                onAuxClick={(e) => {
                                    if (e.button === 1 && !isClosing) {
                                        e.preventDefault();
                                        handleCloseTab(tab.id);
                                    }
                                }}
                                role="tab"
                                aria-selected={isActive}
                                aria-controls={`panel-${tab.id}`}
                                tabIndex={0}
                                draggable={!isClosing}
                                onDragStart={handleDragStart(tab.id, index)}
                                onDragOver={handleDragOver(index)}
                                onDragEnter={handleDragEnter(index)}
                                onDrop={handleDrop(index)}
                                onDragEnd={handleDragEnd}
                                aria-grabbed={isBeingDragged}
                                style={{
                                    ...(isClosing && closingStyle ? {
                                        ...closingStyle,
                                        overflow: 'hidden',
                                        // opacity termina antes que width: la pestaña queda
                                        // invisible mientras colapsa el último tramo, ocultando
                                        // cualquier micro-jank del final de la transición.
                                        transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.13s ease, padding 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                                    } : {
                                        transform: getTabTransform(index),
                                        transition: isBeingDragged ? 'none' : 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                    }),
                                }}
                            >
                                <span className="tabbar__tab-icon">
                                    <i className={tabIcon} />
                                </span>
                                <span className="tabbar__tab-label" title={tab.label}>
                                    {tab.label}
                                </span>
                                <button
                                    className="tabbar__tab-close"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleCloseTab(tab.id);
                                    }}
                                    aria-label={`Cerrar ${tab.label}`}
                                    tabIndex={-1}
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        );
                    })}

                    {/* Botón "+" inline (estilo Chrome) — solo si no hay overflow */}
                    {navTabs.length > 0 && !isOverflowing && (
                        <button
                            className="tabbar__action-btn tabbar__add-btn-inline"
                            onClick={openNavTab}
                            title="Nueva pestaña"
                            aria-label="Nueva pestaña"
                        >
                            <i className="fa-solid fa-plus" />
                        </button>
                    )}
                </div>

                {showScrollIndicators.right && (
                    <button
                        className="tabbar__scroll-button tabbar__scroll-button--right"
                        onClick={() => handleScroll('right')}
                        aria-label="Scroll tabs right"
                    >
                        <i className="fa-solid fa-chevron-right" />
                    </button>
                )}
            </div>

            {/* Grupo derecho: [+ si overflow] | Favoritos | Buscar */}
            <div className="tabbar__actions-right">
                {/* Botón "+" cuando hay overflow (sale del container) */}
                {isOverflowing && (
                    <button
                        className="tabbar__action-btn tabbar__add-btn"
                        onClick={openNavTab}
                        title="Nueva pestaña"
                        aria-label="Nueva pestaña"
                    >
                        <i className="fa-solid fa-plus" />
                    </button>
                )}

                {/* Botón Favoritos */}
                <div className="tabbar__favorites-wrapper" ref={favoritesRef}>
                    <button
                        className={`tabbar__action-btn tabbar__favorites-btn ${isFavoritesOpen ? 'tabbar__favorites-btn--active' : ''} ${favorites.length > 0 ? 'tabbar__favorites-btn--has-items' : ''}`}
                        onClick={() => setIsFavoritesOpen((prev) => !prev)}
                        title="Favoritos"
                        aria-label="Favoritos"
                    >
                        <i className={`fa-${isFavoritesOpen || favorites.length > 0 ? 'solid' : 'regular'} fa-star`} />
                    </button>

                    {isFavoritesOpen && (
                        <div className="tabbar__favorites-dropdown">
                            <div className="tabbar__favorites-header">
                                <i className="fa-solid fa-star" />
                                <span>Favoritos</span>
                            </div>

                            {favorites.length === 0 ? (
                                <div className="tabbar__favorites-empty">
                                    <div className="tabbar__favorites-empty-icon">
                                        <i className="fa-regular fa-star" />
                                    </div>
                                    <p className="tabbar__favorites-empty-title">No tenés favoritos aún</p>
                                    <p className="tabbar__favorites-empty-hint">
                                        <i className="fa-solid fa-mouse" /> Hacé <strong>click derecho</strong> sobre cualquier elemento del menú de navegación para agregarlo a favoritos.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="tabbar__favorites-hint">
                                        <i className="fa-solid fa-circle-info" />
                                        <span>Click derecho en el menú de navegación para agregar favoritos.</span>
                                    </div>
                                    <div className="tabbar__favorites-list">
                                        {favorites.map((fav) => (
                                            <div
                                                key={fav.id}
                                                className="tabbar__favorites-item"
                                                onClick={() => handleFavoriteClick(fav)}
                                            >
                                                <span className="tabbar__favorites-item-icon">
                                                    <i className={fav.icon || 'fa-solid fa-file-lines'} />
                                                </span>
                                                <span className="tabbar__favorites-item-info">
                                                    <span className="tabbar__favorites-item-label">{fav.label}</span>
                                                    {parentPathMap[fav.initialPath] && (
                                                        <span className="tabbar__favorites-item-path">{parentPathMap[fav.initialPath]}</span>
                                                    )}
                                                </span>
                                                <button
                                                    className="tabbar__favorites-item-remove"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeFavorite(fav.id);
                                                    }}
                                                    title="Quitar de favoritos"
                                                    aria-label={`Quitar ${fav.label} de favoritos`}
                                                >
                                                    <i className="fa-solid fa-xmark" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Botón buscar (extremo derecho) */}
                <div className="tabbar__search" ref={searchRef}>
                    <button
                        type="button"
                        className={`tabbar__action-btn ${isSearchOpen ? 'tabbar__search-btn--active' : ''}`}
                        onClick={() => setIsSearchOpen((prev) => !prev)}
                        title="Buscar (Ctrl+K)"
                        aria-label="Buscar"
                    >
                        <i className="fa-solid fa-magnifying-glass" />
                    </button>
                    {isSearchOpen && (
                        <div className="tabbar__search-panel">
                            <SearchSuggest
                                items={menuIndex}
                                onSelect={handleSelect}
                                onSelectSecondary={handleSelectSecondary}
                                autoFocus
                                className="tabbar__search-suggest"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TabBar;
