// MenuPermTree.jsx
import React, { useEffect, useState } from 'react';
import { Checkbox } from 'primereact/checkbox';
import { Accordion, AccordionTab } from 'primereact/accordion';
import { Badge } from 'primereact/badge';
import axios from 'axios';
import { config } from '../../../../config/config';
import LoadSpinner from '../../../../common/components/loadspinner/LoadSpinner';
import './MenuPermTree.css';

/* ─────────── columnas de permisos ─────────── */
const fields = [
  { key: 'puedeVer', label: 'Ver', icon: 'fa-solid fa-eye', color: 'info' },
  { key: 'puedeAgregar', label: 'Crear', icon: 'fa-solid fa-plus', color: 'success' },
  { key: 'puedeEditar', label: 'Editar', icon: 'fa-solid fa-pencil', color: 'warning' },
  { key: 'puedeBorrar', label: 'Borrar', icon: 'fa-solid fa-trash', color: 'danger' },
];

const MenuPermTree = ({ value = {}, onChange }) => {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState([]);

  /* ─────────── carga del árbol ─────────── */
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${config.backendUrl}/api/menus`, { headers: config.headers });
        setTree(res.data);
        // Expandir todas las secciones por defecto
        setExpandedSections(res.data.map((_, idx) => idx));
      } catch (error) {
        console.error("Error al cargar menús", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  /* ─────────── helpers ─────────── */
  const findNode = (nodes, id) => {
    for (const n of nodes) {
      if (n.idMenu === id) return n;
      const found = findNode(n.children || [], id);
      if (found) return found;
    }
    return null;
  };

  const applyToSubtree = (node, field, checked, draft) => {
    if (!node) return;
    draft[node.idMenu] = {
      ...(draft[node.idMenu] || { idMenu: node.idMenu }),
      [field]: checked,
    };
    (node.children || []).forEach((c) =>
      applyToSubtree(c, field, checked, draft)
    );
  };

  const toggle = (id, field, checked) => {
    const next = { ...value };
    const node = findNode(tree, id);
    applyToSubtree(node, field, checked, next);
    onChange(next);
  };

  /* marca/desmarca todos los permisos (Ver/Crear/Editar/Borrar) de un solo menú */
  const toggleRow = (id, checked) => {
    const next = { ...value };
    next[id] = { ...(next[id] || { idMenu: id }) };
    fields.forEach((f) => {
      next[id][f.key] = checked;
    });
    onChange(next);
  };

  const isRowFullyChecked = (node) => {
    const perms = value[node.idMenu];
    return !!perms && fields.every((f) => perms[f.key]);
  };

  const isRowPartiallyChecked = (node) => {
    const perms = value[node.idMenu];
    if (!perms) return false;
    const some = fields.some((f) => perms[f.key]);
    const all = fields.every((f) => perms[f.key]);
    return some && !all;
  };

  const getPermissionCount = (node) => {
    let count = 0;
    const perms = value[node.idMenu];
    if (perms) {
      fields.forEach(f => {
        if (perms[f.key]) count++;
      });
    }
    (node.children || []).forEach(child => {
      count += getPermissionCount(child);
    });
    return count;
  };

  const renderPermissionCheckboxes = (node) => {
    const full = isRowFullyChecked(node);
    const partial = isRowPartiallyChecked(node);
    return (
    <div className="permission-checkboxes">
      <div className="permission-checkbox-item perm-row-toggle">
        <Checkbox
          inputId={`row-${node.idMenu}`}
          checked={full}
          inputRef={(el) => { if (el) el.indeterminate = partial; }}
          onChange={(e) => toggleRow(node.idMenu, e.checked)}
          className="perm-checkbox perm-checkbox-row"
        />
        <label htmlFor={`row-${node.idMenu}`} className="permission-label">
          <i className="fa-solid fa-list-check"></i>
          <span>Todo</span>
        </label>
      </div>
      {fields.map((f) => (
        <div key={f.key} className="permission-checkbox-item">
          <Checkbox
            inputId={`${f.key}-${node.idMenu}`}
            checked={!!value[node.idMenu]?.[f.key]}
            onChange={(e) => toggle(node.idMenu, f.key, e.checked)}
            className={`perm-checkbox perm-checkbox-${f.color}`}
          />
          <label htmlFor={`${f.key}-${node.idMenu}`} className="permission-label">
            <i className={f.icon}></i>
            <span>{f.label}</span>
          </label>
        </div>
      ))}
    </div>
    );
  };

  const renderNode = (node, level = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isParent = level === 0;
    
    return (
      <div key={node.idMenu} className={`menu-node ${isParent ? 'parent-node' : ''}`}>
        <div className="node-header">
          <div className="node-info">
            <i className={`node-icon fa-solid ${node.icono || 'fa-circle'}`}></i>
            <span className="node-name">{node.nombre}</span>
          </div>
          {renderPermissionCheckboxes(node)}
        </div>
        
        {hasChildren && (
          <div className="node-children" style={{ marginLeft: isParent ? '0' : '24px' }}>
            {node.children.map((c) => renderNode(c, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const groupTreeByParent = () => {
    return tree.map((parent, idx) => ({
      parent,
      index: idx,
      permCount: getPermissionCount(parent)
    }));
  };

  if (loading) {
    return (
      <div className="w-full mb-5 flex align-self-center justify-content-center py-5">
        <LoadSpinner />
      </div>
    );
  }

  return (
    <div className="menu-perm-tree">
      <div className="permissions-legend">
        {fields.map((f) => (
          <div key={f.key} className="legend-item">
            <i className={`${f.icon} legend-icon legend-icon-${f.color}`}></i>
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      <Accordion 
        multiple 
        activeIndex={expandedSections}
        onTabChange={(e) => setExpandedSections(e.index)}
        className="permissions-accordion"
      >
        {groupTreeByParent().map(({ parent, index, permCount }) => (
          <AccordionTab
            key={parent.idMenu}
            header={
              <div className="accordion-header-content">
                <div className="flex align-items-center gap-2">
                  <i className={`fa-solid ${parent.icono || 'fa-circle'} header-icon`}></i>
                  <span className="header-title">{parent.nombre}</span>
                </div>
                {permCount > 0 && (
                  <Badge value={permCount} severity="info" className="permission-count-badge" />
                )}
              </div>
            }
          >
            <div className="accordion-content">
              {renderNode(parent, 0)}
            </div>
          </AccordionTab>
        ))}
      </Accordion>
    </div>
  );
};

export default MenuPermTree;