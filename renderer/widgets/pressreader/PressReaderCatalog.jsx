import { useMemo, useState } from 'react';
import { PRESSREADER_CATEGORY_ASSETS, PRESSREADER_CATEGORY_PUBLICATIONS, pressReaderSlug } from './pressreader.categories.js';

const NAV_ITEMS = [
  { id: 'for-you', label: 'Pour vous', icon: 'newspaper' },
  { id: 'browse', label: 'Parcourir', icon: 'browse' },
  { id: 'library', label: 'Ma bibliot...', icon: 'download' },
  { id: 'collections', label: 'Collections', icon: 'bookmark' },
  { id: 'more', label: 'Plus', icon: 'more' },
];

function iconPath(icon) {
  if (icon === 'newspaper') return 'M4 5h13a3 3 0 0 1 3 3v11H6a2 2 0 0 1-2-2V5Zm3 4h8M7 13h8M7 17h5M20 9h1v8a2 2 0 0 1-2 2';
  if (icon === 'browse') return 'M5 19V8m5 11V5m5 14v-8m5 8V7';
  if (icon === 'download') return 'M12 4v10m0 0 4-4m-4 4-4-4M5 20h14';
  if (icon === 'bookmark') return 'M7 4h10v16l-5-3-5 3V4Z';
  return 'M5 12h.01M12 12h.01M19 12h.01';
}

function PressReaderIcon({ icon }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={iconPath(icon)} />
    </svg>
  );
}

function categoryMatchesGroup(category, group) {
  const categorySlug = pressReaderSlug(category.title);
  const groupSlug = pressReaderSlug(group?.title || group?.id || '');
  if (!categorySlug || !groupSlug) return false;
  return groupSlug === categorySlug || groupSlug.includes(categorySlug) || categorySlug.includes(groupSlug);
}

function mergeCategories(catalogCategories = []) {
  const bySlug = new Map();
  PRESSREADER_CATEGORY_ASSETS.forEach((category, index) => {
    bySlug.set(category.id, {
      ...category,
      sort: index,
      catalog: null,
    });
  });
  catalogCategories.forEach((category, index) => {
    const slug = pressReaderSlug(category.title || category.id);
    if (!slug) return;
    const existing = bySlug.get(slug);
    bySlug.set(slug, {
      ...(existing || {
        id: slug,
        title: category.title || category.id || 'Catégorie',
        image: `https://picsum.photos/seed/pressreader-${slug}/1200/440`,
        tint: '#6aaad2',
        sort: PRESSREADER_CATEGORY_ASSETS.length + index,
      }),
      catalog: category,
      title: existing?.title || category.title || category.id || 'Catégorie',
    });
  });
  return [...bySlug.values()].sort((a, b) => a.sort - b.sort);
}

function getCategoryPublications(category, groups = []) {
  const match = getCategoryGroup(category, groups);
  if (match?.publications?.length) return match.publications;
  return (PRESSREADER_CATEGORY_PUBLICATIONS[category?.id] || []).map(item => ({
    ...item,
    categoryId: category?.id,
    categoryTitle: category?.title,
    previewOnly: true,
  }));
}

function getCategoryGroup(category, groups = []) {
  return groups.find(group => categoryMatchesGroup(category, group));
}

function PlaceholderCover({ index }) {
  return (
    <span className="pressreader-mobile-cover" aria-hidden="true">
      <span />
      <i style={{ width: `${58 + (index % 3) * 10}%` }} />
      <i style={{ width: `${42 + (index % 4) * 8}%` }} />
      <i style={{ width: `${64 - (index % 3) * 7}%` }} />
    </span>
  );
}

export default function PressReaderCatalog({
  catalogCategories = [],
  catalogGroups = [],
  featuredItem = null,
  status = '',
  query = '',
  onQueryChange,
  onOpenItem,
  onRefresh,
  onBootstrap,
  onDailyRefresh,
  onToggleCategory,
  onCategoryOpen,
  categorySelection = {},
  categoryLoadingId = '',
  automationBlocked = false,
  scanning = false,
  crawling = false,
  onClose,
}) {
  const [activeNav, setActiveNav] = useState('browse');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const categories = useMemo(() => mergeCategories(catalogCategories), [catalogCategories]);
  const selectedGroup = selectedCategory ? getCategoryGroup(selectedCategory, catalogGroups) : null;
  const selectedPublications = selectedCategory ? getCategoryPublications(selectedCategory, catalogGroups) : [];
  const heroCategory = selectedCategory || categories[0];
  const busy = scanning || crawling;
  const categoryLoading = !!selectedCategory && categoryLoadingId === selectedCategory.id;

  function chooseCategory(category) {
    setSelectedCategory(category);
    setActiveNav('browse');
    onCategoryOpen?.(category);
  }

  function refreshCurrentView() {
    if (selectedCategory) {
      onCategoryOpen?.(selectedCategory);
      return;
    }
    onRefresh?.();
  }

  function renderCategoryList() {
    return (
      <div className="pressreader-mobile-scroll pressreader-mobile-category-grid">
        {categories.map((category, index) => {
          const catalog = category.catalog;
          const checked = !catalog || (Object.prototype.hasOwnProperty.call(categorySelection, catalog.id)
            ? categorySelection[catalog.id] !== false
            : catalog.enabled !== false);
          return (
            <button
              key={category.id}
              type="button"
              className="pressreader-mobile-category"
              style={{
                '--category-image': `url("${category.image}")`,
                '--category-tint': category.tint,
                '--category-delay': `${Math.min(index, 12) * 34}ms`,
              }}
              onClick={() => chooseCategory(category)}
            >
              <span className="pressreader-mobile-category-label">{category.title}</span>
              {catalog && (
                <span
                  className={`pressreader-mobile-category-switch${checked ? ' is-on' : ''}`}
                  title={checked ? 'Catégorie active' : 'Catégorie inactive'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCategory?.(catalog.id, !checked);
                  }}
                >
                  <span />
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  function renderDetail() {
    const covers = selectedPublications.slice(0, 60);
    const activeSection = selectedGroup?.sectionLabel || 'Journaux';
    const groupedSections = selectedGroup?.sections?.length
      ? selectedGroup.sections
      : [{ id: 'default', title: activeSection, publications: covers }];
    return (
      <div className="pressreader-mobile-detail">
        <button type="button" className="pressreader-mobile-back" onClick={() => setSelectedCategory(null)} title="Retour">
          <span />
        </button>
        <div
          className="pressreader-mobile-detail-hero"
          style={{
            '--category-image': `url("${heroCategory?.image}")`,
            '--category-tint': heroCategory?.tint || '#6aaad2',
          }}
        >
          <div>
            <span>Parcourir</span>
            <strong>{heroCategory?.title}</strong>
          </div>
        </div>
        <div className="pressreader-mobile-segments" role="tablist" aria-label="PressReader sections">
          <button type="button" className={activeSection === 'Journaux' ? 'is-active' : ''}>Journaux</button>
          <button type="button" className={activeSection === 'Magazines' ? 'is-active' : ''}>Magazines</button>
          <button type="button">Favoris</button>
        </div>
        <div className="pressreader-mobile-publication-sections">
          {categoryLoading ? Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="pressreader-mobile-publication is-placeholder">
              <PlaceholderCover index={index} />
              <span />
              <small />
            </span>
          )) : covers.length ? groupedSections.map(section => (
            <section key={section.id || section.title} className="pressreader-mobile-publication-section">
              <div className="pressreader-mobile-section-head">
                <strong>{section.title}</strong>
                <span>Tout Voir ›</span>
              </div>
              <div className="pressreader-mobile-cover-grid">
                {(section.publications || []).map((item, index) => (
                  <button
                    key={item.key || item.url || item.image || item.title}
                    type="button"
                    className={`pressreader-mobile-publication${item.previewOnly ? ' is-preview' : ''}`}
                    onClick={() => {
                      if (!item.previewOnly && item.url) onOpenItem?.(item);
                    }}
                    title={item.title}
                    aria-disabled={item.previewOnly ? 'true' : undefined}
                  >
                    {item.image ? <img src={item.image} alt="" loading="lazy" /> : <PlaceholderCover index={index} />}
                    <span>{item.title}</span>
                    <small>{item.issueDate || (item.url ? 'Prêt' : 'Aperçu UI')}</small>
                  </button>
                ))}
              </div>
            </section>
          )) : Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="pressreader-mobile-publication is-placeholder">
              <PlaceholderCover index={index} />
              <span />
              <small />
            </span>
          ))}
        </div>
      </div>
    );
  }

  function renderNavPane() {
    if (activeNav === 'browse') return selectedCategory ? renderDetail() : renderCategoryList();
    return (
      <div className="pressreader-mobile-pane pressreader-mobile-scroll">
        <div
          className="pressreader-mobile-feature"
          style={{
            '--category-image': `url("${heroCategory?.image}")`,
            '--category-tint': heroCategory?.tint || '#6aaad2',
          }}
        >
          <span>{NAV_ITEMS.find(item => item.id === activeNav)?.label}</span>
          <strong>{featuredItem?.title || 'PressReader'}</strong>
          <small>{featuredItem?.categoryTitle || status || 'Catalogue'}</small>
        </div>
        <div className="pressreader-mobile-cover-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <span key={index} className="pressreader-mobile-publication is-placeholder">
              <PlaceholderCover index={index} />
              <span />
              <small />
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`pressreader-mobile${selectedCategory ? ' is-detail' : ''}`}>
      <style>{`
        @keyframes pressReaderCategoryIn{from{opacity:0;transform:translate3d(0,18px,0) scale(.985)}to{opacity:1;transform:none}}
        @keyframes pressReaderPaneIn{from{opacity:.1;transform:translate3d(26px,0,0)}to{opacity:1;transform:none}}
        .pressreader-mobile{
          position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;overflow:hidden;
          background:linear-gradient(180deg,#242223 0,#171718 78%,#101111 100%);
          color:#fff;pointer-events:auto;font-family:'DM Sans',system-ui,sans-serif;
        }
        .pressreader-mobile svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
        .pressreader-mobile-top{
          height:56px;flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:0 18px;
          background:#2c292b;border-bottom:1px solid rgba(255,255,255,.035);
        }
        .pressreader-mobile-close,.pressreader-mobile-action,.pressreader-mobile-back{
          border:0;background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;padding:0;
        }
        .pressreader-mobile-close{width:32px;height:32px;position:relative;flex:0 0 auto}
        .pressreader-mobile-close::before,.pressreader-mobile-close::after{
          content:"";position:absolute;width:28px;height:3px;border-radius:2px;background:currentColor;
        }
        .pressreader-mobile-close::before{transform:rotate(45deg)}
        .pressreader-mobile-close::after{transform:rotate(-45deg)}
        .pressreader-mobile-title{font-size:24px;line-height:1;font-weight:750;letter-spacing:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pressreader-mobile-spacer{flex:1}
        .pressreader-mobile-action{width:32px;height:32px;border-radius:8px;color:rgba(255,255,255,.76)}
        .pressreader-mobile-action:hover,.pressreader-mobile-action.is-on{background:rgba(255,255,255,.08);color:#fff}
        .pressreader-mobile-actions{
          position:absolute;right:12px;top:50px;z-index:12;width:min(320px,calc(100% - 24px));padding:10px;
          border:1px solid rgba(255,255,255,.10);border-radius:8px;background:rgba(18,19,20,.96);
          box-shadow:0 20px 60px rgba(0,0,0,.42);display:grid;gap:8px;
        }
        .pressreader-mobile-actions input{
          width:100%;height:34px;border-radius:7px;border:1px solid rgba(255,255,255,.13);
          background:rgba(255,255,255,.06);color:#fff;padding:0 10px;outline:none;font-size:12px;
        }
        .pressreader-mobile-actions-row{display:flex;gap:7px;flex-wrap:wrap}
        .pressreader-mobile-actions-row button{
          height:28px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);
          color:rgba(255,255,255,.88);font-size:10px;padding:0 9px;cursor:pointer;
        }
        .pressreader-mobile-actions-row button:disabled{opacity:.4;cursor:default}
        .pressreader-mobile-status{font:9px 'DM Mono',monospace;color:rgba(255,255,255,.52);line-height:1.35}
        .pressreader-mobile-body{position:relative;flex:1;min-height:0;overflow:hidden}
        .pressreader-mobile-scroll{
          position:absolute;inset:0;overflow:auto;padding:10px 12px 84px;display:flex;flex-direction:column;gap:14px;
          animation:pressReaderPaneIn 320ms cubic-bezier(.18,.82,.24,1) both;
        }
        .pressreader-mobile-category-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          align-content:start;
          gap:10px;
        }
        .pressreader-mobile-category{
          position:relative;min-height:136px;width:100%;border:0;border-radius:8px;overflow:hidden;cursor:pointer;text-align:left;color:#fff;
          background:
            linear-gradient(90deg,rgba(0,0,0,.58),rgba(0,0,0,.18) 58%,rgba(0,0,0,.24)),
            linear-gradient(120deg,color-mix(in srgb,var(--category-tint),#050505 35%),#151515),
            var(--category-image) center/cover;
          box-shadow:0 12px 28px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.06);
          animation:pressReaderCategoryIn 420ms cubic-bezier(.18,.82,.24,1) both;
          animation-delay:var(--category-delay);
          transform:translateZ(0);
        }
        .pressreader-mobile-category::after{
          content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(0,0,0,.14));
          opacity:.85;transition:opacity .18s,transform .18s;
        }
        .pressreader-mobile-category:hover::after{opacity:.45;transform:scale(1.02)}
        .pressreader-mobile-category-label{
          position:absolute;left:14px;right:46px;bottom:16px;z-index:1;font-size:18px;line-height:1.08;font-weight:560;
          text-shadow:0 2px 16px rgba(0,0,0,.66);letter-spacing:0;
        }
        .pressreader-mobile-category-switch{
          position:absolute;right:12px;bottom:12px;z-index:2;width:34px;height:22px;border-radius:999px;
          border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.38);display:flex;align-items:center;padding:3px;
        }
        .pressreader-mobile-category-switch span{width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.76);transition:transform .18s,background .18s}
        .pressreader-mobile-category-switch.is-on{border-color:rgba(53,220,164,.62);background:rgba(53,220,164,.22)}
        .pressreader-mobile-category-switch.is-on span{transform:translateX(12px);background:#35dca4}
        .pressreader-mobile-bottom{
          position:absolute;left:0;right:0;bottom:0;z-index:10;height:74px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));
          background:#111213;border-top:1px solid rgba(255,255,255,.045);padding:8px 6px 7px;
          box-shadow:0 -12px 28px rgba(0,0,0,.22);
        }
        .pressreader-mobile-nav{
          min-width:0;border:0;background:transparent;color:rgba(255,255,255,.56);display:flex;flex-direction:column;align-items:center;gap:5px;
          font-size:13px;line-height:1;cursor:pointer;transition:color .18s,transform .18s;
        }
        .pressreader-mobile-nav span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pressreader-mobile-nav.is-active{color:#35dca4;transform:translateY(-1px)}
        .pressreader-mobile-nav.is-active svg{filter:drop-shadow(0 0 9px rgba(53,220,164,.45))}
        .pressreader-mobile-detail{position:absolute;inset:0;padding:12px 12px 84px;overflow:auto;animation:pressReaderPaneIn 320ms cubic-bezier(.18,.82,.24,1) both}
        .pressreader-mobile-back{
          position:absolute;left:20px;top:22px;z-index:2;width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.34);backdrop-filter:blur(8px);
        }
        .pressreader-mobile-back span{
          width:13px;height:13px;border-left:3px solid currentColor;border-bottom:3px solid currentColor;transform:rotate(45deg);margin-left:5px;
        }
        .pressreader-mobile-detail-hero,.pressreader-mobile-feature{
          min-height:220px;border-radius:8px;overflow:hidden;display:flex;align-items:flex-end;padding:26px 24px;
          background:
            linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.72)),
            linear-gradient(120deg,color-mix(in srgb,var(--category-tint),#050505 34%),#151515),
            var(--category-image) center/cover;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 12px 30px rgba(0,0,0,.24);
        }
        .pressreader-mobile-detail-hero span,.pressreader-mobile-feature span{display:block;font:10px 'DM Mono',monospace;color:rgba(255,255,255,.64);text-transform:uppercase;letter-spacing:.08em}
        .pressreader-mobile-detail-hero strong,.pressreader-mobile-feature strong{display:block;margin-top:6px;font-size:30px;line-height:1.04;font-weight:760;letter-spacing:0;text-shadow:0 2px 18px rgba(0,0,0,.56)}
        .pressreader-mobile-feature small{display:block;margin-top:8px;color:rgba(255,255,255,.62);font-size:12px}
        .pressreader-mobile-segments{height:36px;margin:12px 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
        .pressreader-mobile-segments button{
          border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.055);color:rgba(255,255,255,.68);
          border-radius:7px;font-size:12px;cursor:pointer;
        }
        .pressreader-mobile-segments button.is-active{background:rgba(53,220,164,.18);border-color:rgba(53,220,164,.35);color:#dffff4}
        .pressreader-mobile-publication-sections{display:grid;gap:18px}
        .pressreader-mobile-publication-sections:has(> .pressreader-mobile-publication.is-placeholder){grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
        .pressreader-mobile-publication-section{display:grid;gap:8px;min-width:0}
        .pressreader-mobile-section-head{
          min-height:24px;display:flex;align-items:center;justify-content:space-between;gap:12px;
          color:rgba(255,255,255,.9);
        }
        .pressreader-mobile-section-head strong{font-size:13px;line-height:1.1;font-weight:720;letter-spacing:0}
        .pressreader-mobile-section-head span{font:10px 'DM Mono',monospace;color:rgba(255,255,255,.42)}
        .pressreader-mobile-cover-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
        .pressreader-mobile-publication-section .pressreader-mobile-cover-grid{
          grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(104px,128px);
          overflow-x:auto;overflow-y:hidden;padding:1px 2px 7px;scrollbar-width:thin;scrollbar-color:rgba(53,220,164,.42) transparent;
        }
        .pressreader-mobile-publication-section .pressreader-mobile-cover-grid::-webkit-scrollbar{height:6px}
        .pressreader-mobile-publication-section .pressreader-mobile-cover-grid::-webkit-scrollbar-track{background:transparent}
        .pressreader-mobile-publication-section .pressreader-mobile-cover-grid::-webkit-scrollbar-thumb{background:rgba(53,220,164,.28);border-radius:999px}
        .pressreader-mobile-publication{
          min-width:0;border:0;background:transparent;color:#fff;text-align:left;display:grid;gap:6px;cursor:pointer;
        }
        .pressreader-mobile-publication.is-preview{cursor:default}
        .pressreader-mobile-publication.is-preview img{filter:saturate(.86) brightness(.82) contrast(1.04)}
        .pressreader-mobile-publication img,.pressreader-mobile-cover{
          width:100%;aspect-ratio:3/4;border-radius:6px;object-fit:cover;background:linear-gradient(145deg,rgba(255,255,255,.10),rgba(255,255,255,.035));
          box-shadow:0 9px 20px rgba(0,0,0,.24),inset 0 0 0 1px rgba(255,255,255,.08);
        }
        .pressreader-mobile-publication > span:not(.pressreader-mobile-cover){
          font-size:11px;line-height:1.18;color:rgba(255,255,255,.86);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
        }
        .pressreader-mobile-publication small{font:9px 'DM Mono',monospace;color:rgba(255,255,255,.46);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pressreader-mobile-cover{display:flex;flex-direction:column;justify-content:flex-end;gap:8px;padding:12px}
        .pressreader-mobile-cover span{width:42%;height:22%;border-radius:4px;background:rgba(53,220,164,.38)}
        .pressreader-mobile-cover i{display:block;height:5px;border-radius:999px;background:rgba(255,255,255,.18)}
        .pressreader-mobile-publication.is-placeholder{cursor:default}
        .pressreader-mobile-publication.is-placeholder > span:not(.pressreader-mobile-cover){
          width:86%;height:9px;border-radius:999px;background:rgba(255,255,255,.10);display:block;
        }
        .pressreader-mobile-publication.is-placeholder small{width:48%;height:7px;border-radius:999px;background:rgba(255,255,255,.07)}
        .pressreader-mobile-pane{gap:12px}
        @media (max-width:720px){
          .pressreader-mobile-category-grid{gap:9px;padding-left:10px;padding-right:10px}
          .pressreader-mobile-category{min-height:126px}
          .pressreader-mobile-category-label{font-size:16px;left:12px;right:42px;bottom:14px}
          .pressreader-mobile-title{font-size:23px}
        }
      `}</style>
      <div className="pressreader-mobile-top">
        <button type="button" className="pressreader-mobile-close" onClick={onClose} title="Fermer" />
        <div className="pressreader-mobile-title">{selectedCategory ? selectedCategory.title : 'Catégories'}</div>
        <div className="pressreader-mobile-spacer" />
        <button
          type="button"
          className={`pressreader-mobile-action${actionsOpen ? ' is-on' : ''}`}
          onClick={() => setActionsOpen(value => !value)}
          title="Options"
        >
          <PressReaderIcon icon="more" />
        </button>
      </div>
      {actionsOpen && (
        <div className="pressreader-mobile-actions">
          <input value={query} onChange={event => onQueryChange?.(event.target.value)} placeholder="Filtrer les publications" />
          <div className="pressreader-mobile-actions-row">
            <button type="button" onClick={refreshCurrentView} disabled={automationBlocked || busy || categoryLoading}>
              {automationBlocked ? 'Pause' : crawling ? 'Synchro' : scanning ? 'Scan' : 'Rafraîchir'}
            </button>
            <button type="button" onClick={onBootstrap} disabled={automationBlocked || scanning}>Indexer</button>
            <button type="button" onClick={onDailyRefresh} disabled={automationBlocked || crawling || !catalogCategories.length}>Quotidien</button>
          </div>
          <div className="pressreader-mobile-status">{status || `${catalogCategories.length || PRESSREADER_CATEGORY_ASSETS.length} catégories`}</div>
        </div>
      )}
      <div className="pressreader-mobile-body">{renderNavPane()}</div>
      <div className="pressreader-mobile-bottom">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={`pressreader-mobile-nav${activeNav === item.id ? ' is-active' : ''}`}
            onClick={() => {
              setActiveNav(item.id);
              if (item.id !== 'browse') setSelectedCategory(null);
            }}
          >
            <PressReaderIcon icon={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
