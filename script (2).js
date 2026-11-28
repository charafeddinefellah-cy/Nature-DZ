/* ==========================================================
   NATURE DZ – script.js
   Navigation, découverte, carte Leaflet, signalements,
   tableau de bord, guide écologique.
   Stockage : LocalStorage uniquement (aucune donnée envoyée).
   ========================================================== */
(() => {
  'use strict';

  /* ---------- Utilitaires ---------- */
  const KEYS = { reports: 'naturedz_reports', favs: 'naturedz_favorites', checklist: 'naturedz_checklist' };
  // Migration : le projet s’appelait « GREEN DZ ». Les données déjà enregistrées sous les anciennes clés
  // sont copiées vers les nouvelles, puis l’ancienne clé n’est supprimée qu’après une copie vérifiée.
  const LEGACY_KEYS = { reports: 'greendz_reports', favs: 'greendz_favorites', checklist: 'greendz_checklist' };
  (function migrateLegacyStorage() {
    try {
      Object.keys(LEGACY_KEYS).forEach(k => {
        const old = localStorage.getItem(LEGACY_KEYS[k]);
        if (old === null || localStorage.getItem(KEYS[k]) !== null) return;
        localStorage.setItem(KEYS[k], old);
        if (localStorage.getItem(KEYS[k]) === old) localStorage.removeItem(LEGACY_KEYS[k]);
      });
    } catch { /* stockage indisponible : rien à migrer */ }
  })();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const firstSentence = t => t.split('. ')[0].replace(/\.$/, '') + '.';

  const store = {
    get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };

  function toast(msg, type = 'info') {
    const box = $('#toastContainer');
    if (!box) return;
    while (box.children.length >= 4) box.firstChild.remove();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 360); }, 4800);
  }

  /* ---------- Données ---------- */
  const CATS = {
    foret: { label: 'Forêt', icon: '🌲' },
    lac: { label: 'Lac', icon: '💧' },
    montagne: { label: 'Montagne', icon: '⛰️' },
    parc: { label: 'Parc national', icon: '🏞️' }
  };
  const TYPES = {
    incendie: { label: 'Incendie', icon: '🔥' },
    pollution: { label: 'Pollution', icon: '🏭' },
    dechets: { label: 'Déchets sauvages', icon: '🗑️' },
    deforestation: { label: 'Déforestation', icon: '🪓' },
    autre: { label: 'Autre', icon: '❓' }
  };
  const GRAV = { faible: 'Faible', moyenne: 'Moyenne', elevee: 'Élevée' };

  const WILAYAS = ['Adrar', 'Chlef', 'Laghouat', 'Oum El Bouaghi', 'Batna', 'Béjaïa', 'Biskra', 'Béchar', 'Blida', 'Bouira', 'Tamanrasset', 'Tébessa', 'Tlemcen', 'Tiaret', 'Tizi Ouzou', 'Alger', 'Djelfa', 'Jijel', 'Sétif', 'Saïda', 'Skikda', 'Sidi Bel Abbès', 'Annaba', 'Guelma', 'Constantine', 'Médéa', 'Mostaganem', 'M’Sila', 'Mascara', 'Ouargla', 'Oran', 'El Bayadh', 'Illizi', 'Bordj Bou Arréridj', 'Boumerdès', 'El Tarf', 'Tindouf', 'Tissemsilt', 'El Oued', 'Khenchela', 'Souk Ahras', 'Tipaza', 'Mila', 'Aïn Defla', 'Naâma', 'Aïn Témouchent', 'Ghardaïa', 'Relizane', 'El M’Ghair', 'El Meniaa', 'Ouled Djellal', 'Bordj Badji Mokhtar', 'Béni Abbès', 'Timimoun', 'Touggourt', 'Djanet', 'In Salah', 'In Guezzam',
    // Onze nouvelles wilayas (n° 59 à 69), créées en 2026
    'Aflou', 'Barika', 'El Kantara', 'Bir El Ater', 'El Aricha', 'Ksar Chellala', 'Aïn Ouessara', 'Messaad', 'Ksar El Boukhari', 'Bou Saâda', 'El Abiodh Sidi Cheikh'];

  /* Fiche type d’une destination (cible de l’étape 2 du plan ; seuls les 7 premiers champs sont utilisés aujourd’hui) :
       id, nom, catégorie (foret | lac | montagne | parc), wilaya, latitude, longitude, description,
     champs à ajouter, chacun avec une source citée :
       region (littoral | tell | hauts-plateaux | sahara), altitude, protection (statut et année),
       saison (meilleure période), activites, faune, flore, acces, conseils, sources[]. */
  // [id, nom, catégorie, wilaya, latitude, longitude, description, image (optionnelle)]
  const FILE = f => `https://commons.wikimedia.org/wiki/Special:FilePath/${f}?width=960`;
  const PAGE = f => `https://commons.wikimedia.org/wiki/File:${f}`;
  const SITES = [
    ['tassili', 'Tassili n’Ajjer', 'parc', 'Illizi / Djanet', 25.0, 9.0, 'Vaste plateau de grès du Sahara, classé au patrimoine mondial de l’UNESCO. Ses « forêts de pierre » abritent de remarquables peintures et gravures rupestres.'],
    ['ahaggar', 'Ahaggar (Hoggar)', 'parc', 'Tamanrasset', 23.3, 5.6, 'Massif volcanique du Sahara central dominé par le mont Tahat (2 908 m), point culminant du pays. Paysages minéraux spectaculaires et plateau de l’Assekrem.'],
    ['djurdjura', 'Massif du Djurdjura', 'montagne', 'Tizi Ouzou / Bouira', 36.45, 4.15, 'Massif calcaire de Kabylie qui dépasse 2 300 m, avec des cèdres de l’Atlas, de hautes falaises et une faune rare dont le singe magot.'],
    ['chrea', 'Parc national de Chréa', 'parc', 'Blida', 36.43, 2.88, 'Parc de l’Atlas tellien couvert de forêts de cèdres. Il offre des sentiers de randonnée et de beaux points de vue sur la plaine de la Mitidja.'],
    ['gouraya', 'Parc national de Gouraya', 'parc', 'Béjaïa', 36.77, 5.1, 'Parc côtier mêlant falaises, grottes et forêt méditerranéenne au-dessus de la baie de Béjaïa. C’est un refuge du singe magot.'],
    ['elkala', 'Parc national d’El Kala', 'parc', 'El Tarf', 36.88, 8.45, 'Réserve de biosphère de l’UNESCO associant forêts de chênes-lièges, lacs, dunes et littoral, près de la frontière tunisienne.'],
    ['tonga', 'Lac Tonga', 'lac', 'El Tarf', 36.85, 8.5, 'Lac d’eau douce classé zone humide d’importance internationale (Ramsar). Il accueille de nombreux oiseaux d’eau.'],
    ['oubeira', 'Lac Oubeira', 'lac', 'El Tarf', 36.85, 8.4, 'Lac d’eau douce du parc d’El Kala, lui aussi classé site Ramsar, entouré de marais et de forêts.'],
    ['mellah', 'Lac Mellah', 'lac', 'El Tarf', 36.9, 8.33, 'Lac saumâtre séparé de la Méditerranée par un cordon dunaire, classé site Ramsar dans la région d’El Kala.'],
    ['belezma', 'Parc national de Belezma', 'parc', 'Batna', 35.65, 6.05, 'Parc de l’Aurès connu pour ses forêts de cèdres, ses gorges et sa flore de montagne.'],
    ['theniet', 'Cèdraie de Theniet El Had', 'parc', 'Tissemsilt', 35.87, 2.0, 'Célèbre forêt de cèdres de l’Ouarsenis, protégée par un parc national et appréciée pour ses sentiers ombragés.'],
    ['taza', 'Parc national de Taza', 'parc', 'Jijel', 36.67, 5.55, 'Parc côtier de Kabylie orientale : falaises, grottes marines et forêts face à la Méditerranée.'],
    ['chelia', 'Djebel Chélia', 'montagne', 'Khenchela', 35.32, 6.64, 'Plus haut sommet de l’Aurès (environ 2 328 m), entouré de forêts de cèdres.'],
    ['tlemcen', 'Parc national de Tlemcen', 'parc', 'Tlemcen', 34.85, -1.32, 'Parc de l’ouest du pays réunissant forêts, gorges et cascades autour du plateau de Lalla Setti.'],
    ['tikjda', 'Tikjda', 'montagne', 'Bouira', 36.45, 4.12, 'Station de montagne du Djurdjura, dans la wilaya de Bouira, entourée de crêtes qui blanchissent en hiver. Le lac Aguelmim se trouve à proximité.'],
    ['akfadou', 'Forêt d’Akfadou', 'foret', 'Béjaïa', 36.6, 4.58, 'Massif forestier de Petite Kabylie, dans la wilaya de Béjaïa, qui abrite le Lac Noir. Le cerf de Barbarie y a fait l’objet d’une réintroduction.'],
    ['erraguene', 'Barrage d’Erraguene', 'lac', 'Jijel', 36.58, 5.58, 'Retenue d’eau sur l’oued Djendjen, dans la wilaya de Jijel, au milieu des reliefs de l’est de la Kabylie.'],
    ['bainem', 'Forêt de Baïnem', 'foret', 'Alger', 36.8, 2.98, 'Forêt périurbaine des hauteurs ouest d’Alger, appréciée pour la promenade et la détente.'],
    ['zeralda', 'Forêt de Zeralda', 'foret', 'Alger', 36.71, 2.84, 'Forêt littorale à l’ouest d’Alger, populaire pour les sorties en famille.'],
    ['babor', 'Forêt de Babor', 'foret', 'Sétif / Béjaïa', 36.5, 5.5, 'Massif forestier qui abrite le sapin de Numidie, une espèce endémique d’Algérie.']
  ].map(([id, nom, cat, wilaya, lat, lng, desc, img]) => ({ id, nom, cat, wilaya, lat, lng, desc, img: img || '' }));
  // Photos réelles (Wikimedia Commons) : fichier, légende, auteur/source
  const PHOTOS = {
    chrea: { f: 'Montagne_de_Chr%C3%A9a%2C.jpg', cap: 'Hauteurs du massif de Chréa, Atlas blidéen', by: 'Wikimedia Commons' },
    djurdjura: { f: 'Djurjura_enneige.jpg', cap: 'Le Djurdjura sous la neige', by: 'Georges Martin, CC BY 3.0' },
    elkala: { f: 'Parc_National_d%E2%80%99El-Kala_3.JPG', cap: 'Paysage du parc national d’El Kala', by: 'Wikimedia Commons' },
    tonga: { f: 'Parc_National_d%E2%80%99El-Kala_3.JPG', cap: 'Paysage du parc national d’El Kala, qui abrite le lac Tonga', by: 'Wikimedia Commons' },
    erraguene: { f: 'Barrage_d%27Erraguene_(3)_%3B_wilaya_de_Jijel_%3B_Alg%C3%A9rie.jpg', cap: 'Le barrage d’Erraguene, wilaya de Jijel', by: 'Wikimedia Commons' },
    tassili: { f: 'Rock_columns_at_Tassili_n%27Ajjer.jpg', cap: 'Colonnes de grès du Tassili n’Ajjer vues du ciel', by: 'Wikimedia Commons' }
  };
  SITES.forEach(s => { const p = PHOTOS[s.id]; s.photo = p ? { ...p, src: FILE(p.f), page: PAGE(p.f) } : null; });
  const creditHTML = p => `Photo : <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.by)}</a>`;
  const siteById = id => SITES.find(s => s.id === id);

  /* ---------- Galeries photo (Wikimedia Commons) ----------
     Chaque entrée : [titre exact du fichier sur Commons, légende, auteur, licence connue, largeur d’origine en px]
     Licence vide = licence libre à consulter sur la page du fichier (lien affiché sous la photo). */
  const GALLERIES = {
    chrea: [
      ["Montagne de Chréa,.jpg", "Montagne de Chréa, Atlas blidéen", "Hichem amez", "", 2048],
      ["Neige à Chréa.jpg", "Neige à Chréa", "Wikimedia Commons", "", 2560],
      ["Cedars of Chrea.jpg", "Cèdres de Chréa", "Wikimedia Commons", "", 3024],
      ["Chréa en hiver.jpg", "Chréa en hiver", "Wikimedia Commons", "", 1836],
      ["Forêt en Chréa.jpg", "Forêt à Chréa", "Wikimedia Commons", "", 3264],
      ["Pinars.JPG", "Pinède du parc national de Chréa", "Wikimedia Commons", "", 3648]
    ],
    djurdjura: [
      ["Djurjura enneige.jpg", "Le Djurdjura sous la neige (avril 1979)", "Georges Martin", "CC BY 3.0", 1870],
      ["Djurdjura enneigé.jpg", "Sommets enneigés du Djurdjura", "Wikimedia Commons", "", 4608],
      ["Golden Sunrise on Djurdjura (Djurdjura national park).jpg", "Lever de soleil sur le parc national du Djurdjura", "Wikimedia Commons", "", 4160],
      ["LE CERDRE DJURDJURA.jpg", "Cèdre du Djurdjura", "Wikimedia Commons", "", 3000],
      ["Vu sur le Barrage de Tilesdit (Parc National du Djurdjura).jpg", "Le barrage de Tilesdit, vu depuis le parc national du Djurdjura", "Mira Bidouche", "", 4608],
      ["Tala Guilef (Parc national de Djurdjura).jpg", "Tala Guilef, parc national du Djurdjura", "Ambens", "", 3120]
    ],
    tikjda: [
      ["The Aguelmim Lake, Tikjda, Algeria.jpg", "Le lac Aguelmim à Tikjda", "KEBIR", "CC BY-SA 3.0", 5435],
      ["Snow in Tikjda (Djurdjura).jpg", "Neige à Tikjda, Djurdjura", "Wikimedia Commons", "", 1913],
      ["Tikjda NEIGE.jpg", "Tikjda sous la neige", "Wikimedia Commons", "", 3264],
      ["Forêt de Tikjda.jpg", "La forêt de Tikjda", "Wikimedia Commons", "", 2560],
      ["Tikjda Algérie.jpg", "Paysage de Tikjda", "Hafid Tikjda", "", 4032],
      ["Parc national djurdjura, Bouira, Algerie.jpg", "Vue sur l’horizon de Tikjda vers les terres de Bouira", "Amine.Bentoutah", "", 3872]
    ],
    akfadou: [
      ["Lac noir Akfadou.jpg", "Le Lac Noir, forêt d’Akfadou (Béjaïa)", "HocineAttoumi", "CC BY-SA 4.0", 4032],
      ["Lac noir, Akfadou, Bejaia.jpg", "Le Lac Noir d’Akfadou, wilaya de Béjaïa", "Salim hamouche", "", 4129],
      ["Lac Noir - Foret d'Akfadou (Parc National de Bejaia).jpg", "Le Lac Noir, forêt d’Akfadou", "Mira Bidouche", "", 4096],
      ["A nice lake in the Akfadou forest.jpg", "Un lac dans la forêt d’Akfadou", "Wikimedia Commons", "", 4160],
      ["Akfadou.jpg", "La forêt d’Akfadou", "Wikimedia Commons", "", 5760],
      ["Vu de la foret d'Akfadou (Parc National de Bejaia).jpg", "Vue de la forêt d’Akfadou", "Wikimedia Commons", "", 5184]
    ],
    elkala: [
      ["Parc National d’El-Kala 3.JPG", "Paysage du parc national d’El Kala", "Wikimedia Commons", "", 4000],
      ["Allée des embrumes (El Kala national park).jpg", "Allée des embrumes, parc national d’El Kala", "Wikimedia Commons", "", 4092],
      ["El kala wetland.jpg", "Petit marais du parc national d’El Kala", "Amine Mb", "", 3166],
      ["Lac Oubeira, Parc National d'El-Kala, El-Tarf.jpg", "Le lac Oubeira, dans le parc national d’El Kala", "Wikimedia Commons", "", 2972],
      ["Parc National d’El-Kala 2.JPG", "Paysage du parc national d’El Kala", "Wikimedia Commons", "", 4000],
      ["LAC BLEU EL KALA.jpg", "Le Lac Bleu, El Kala", "Wikimedia Commons", "", 4000]
    ],
    tonga: [
      ["Lac tonga el kala.JPG", "Le lac Tonga, El Kala", "Mamed 69", "CC BY-SA 3.0", 3543]
    ],
    oubeira: [
      ["Lac Oubeira, Parc National d'El-Kala, El-Tarf.jpg", "Le lac Oubeira", "Wikimedia Commons", "", 2972]
    ],
    tassili: [
      ["Rock columns at Tassili n'Ajjer.jpg", "Colonnes de grès du Tassili n’Ajjer vues du ciel", "Wikimedia Commons", "", 0],
      ["Tassili N'Ajjer National Park (49465145453).jpg", "Le parc national du Tassili n’Ajjer", "Wikimedia Commons", "", 5168],
      ["Dunes at Tassili n'Ajjer.jpg", "Dunes du Tassili n’Ajjer", "Wikimedia Commons", "", 4032],
      ["Tassili n'Ajjer-Tamghit 02.jpg", "Le plateau de Tamghit, Tassili n’Ajjer", "IssamBarhoumi", "", 5164],
      ["Parc National du Tassili N'AJJER ( W.Illizi ) 01.jpg", "À 50 km de Djanet, direction Bordj El Haouès", "W.aliane9509", "", 5184],
      ["Tikoubaouine Djanet parc national N'ajjer2.jpg", "Tikoubaouine, Djanet, parc national du Tassili", "Wikimedia Commons", "", 6000]
    ],
    ahaggar: [
      ["Assekrem (ahaggar national park).jpg", "L’Assekrem, parc national de l’Ahaggar", "Wikimedia Commons", "", 3072],
      ["Sunrise from Assekrem refuge.jpg", "Lever de soleil depuis le refuge de l’Assekrem", "Wikimedia Commons", "", 7952],
      ["View from the Assekrem.jpg", "Vue depuis l’Assekrem", "Wikimedia Commons", "", 4288],
      ["Adrian Massif, Hoggar National Park.jpg", "Le massif d’Adrian, parc national de l’Ahaggar", "Wikimedia Commons", "", 4160],
      ["Hoggar.jpg", "Le plateau de l’Assekrem, Hoggar (mars 1984)", "Joachim Himmeröder", "", 2318],
      ["Hoggar's Elephant Petroglyph.jpg", "Gravure rupestre d’éléphant dans le Hoggar", "Wikimedia Commons", "", 4128]
    ],
    erraguene: [
      ["Barrage d'Erraguene (3) ; wilaya de Jijel ; Algérie.jpg", "Le barrage d’Erraguene, wilaya de Jijel", "Imene86", "", 3264],
      ["Barrage d'Erraguene; wilaya de Jijel ; Algérie.jpg", "Le barrage d’Erraguene, vu d’une colline qui le surplombe", "Imene86", "CC BY-SA 4.0", 3264],
      ["Barrage d'Erraguene (2) ; wilaya de Jijel ; Algérie.jpg", "Le barrage d’Erraguene, wilaya de Jijel (2)", "Wikimedia Commons", "", 3328],
      ["Barrage d'erraguene sous la neige.jpg", "Le barrage d’Erraguene sous la neige (janvier 2017)", "Mokhtarjet7", "", 4288],
      ["Collines d'Erraguene (2) , Wilaya de Jijel, Algérie.jpg", "Collines d’Erraguene, wilaya de Jijel", "Wikimedia Commons", "", 3264],
      ["Barrage d'Erraguène.jpg", "Le barrage d’Erraguene", "Wikimedia Commons", "", 3264]
    ],
    gouraya: [
      ["Cap Carbon in Gouraya National Park Beach.jpg", "Cap Carbon, parc national de Gouraya", "Halim Ben Khalfallah", "", 6016],
      ["Yema Gouraya point , national park Bejaia Algeria.jpg", "Point de Yemma Gouraya, parc national (Béjaïa)", "Abdel1980", "", 3264],
      ["Béjaïa, Yemma Gouraya.jpg", "Vue vers le mont Yemma Gouraya", "SamirAmiri", "", 3072],
      ["Barbary macaque in Cap Carbon (Gouraya National Park).jpg", "Un singe magot au Cap Carbon", "Wikimedia Commons", "", 4288],
      ["La neige au parc de Gouraya.jpg", "La neige au parc de Gouraya", "Wikimedia Commons", "", 2048],
      ["Gouraya sunset.jpg", "Coucher de soleil sur Gouraya", "Wikimedia Commons", "", 5312]
    ],
    theniet: [
      ["Atlas Cedar forest in snow, Théniet El Had NP, Algeria.jpg", "Forêt de cèdres de l’Atlas sous la neige, Théniet El Had", "Wikimedia Commons", "", 6000],
      ["Cedar Of Atlas trees at Theniet El Had National Parc.jpg", "Cèdres de l’Atlas, parc national de Théniet El Had", "Wikimedia Commons", "", 2322],
      ["Foret des Cèdres Parc National de Theniet el Had (El-Meddad) 1.JPG", "Forêt des cèdres, parc national de Théniet El Had (El Meddad)", "Wikimedia Commons", "", 4752],
      ["Foret des Cèdres Parc National de Theniet el Had (El-Meddad) 2.JPG", "Forêt des cèdres de Théniet El Had (El Meddad)", "Wikimedia Commons", "", 4752],
      ["Theniet El Had National Park.JPG", "Dans la forêt du parc, près de la parcelle expérimentale", "Wikimedia Commons", "", 3648],
      ["145 FORET DES CEDRES DE THENIET EL HAD.jpg", "La forêt des cèdres de Théniet El Had", "Wikimedia Commons", "", 4928]
    ],
    belezma: [
      ["Belezma.JPG", "Le mont Belezma et l’entrée du parc", "Nemencha", "CC BY 1.0", 3648],
      ["Belezma 1.JPG", "Un sommet du massif du Belezma, à l’entrée du parc", "Nemencha", "", 3648],
      ["Cèdre de l'Atlas (Cedrus atlantica) du park national de Belezma 9.JPG", "Cèdre de l’Atlas, parc national de Belezma", "Hamza-sia", "", 2848],
      ["1-Parc national de Belezma Batna-Algerie.jpg", "Parc national de Belezma, Batna", "Wikimedia Commons", "", 5312],
      ["Belezma National Park 1.jpg", "Parc national de Belezma", "Wikimedia Commons", "", 3024],
      ["Montagne thichaw (park national belezma).jpg", "Montagne Thichaw, parc national de Belezma", "Wikimedia Commons", "", 3888]
    ]
  };
  const cFile = f => encodeURIComponent(f.replace(/ /g, '_'));
  const gUrl = (f, w) => `https://commons.wikimedia.org/wiki/Special:FilePath/${cFile(f)}${w ? `?width=${w}` : ''}`;
  // Largeurs « standard » de Wikimedia, sans dépasser la taille d’origine
  const pickW = (w, target) => {
    if (!w) return Math.min(target, 1280);
    for (const t of [target, 1280, 960, 500, 330]) if (t <= target && w >= t) return t;
    return 0;
  };
  SITES.forEach(s => {
    s.gallery = (GALLERIES[s.id] || []).map(([f, cap, by, lic, w]) => ({
      f, cap, by, lic, page: `https://commons.wikimedia.org/wiki/File:${cFile(f)}`,
      thumb: gUrl(f, pickW(w, 330)), src: gUrl(f, pickW(w, 1280)), big: gUrl(f, pickW(w, 1920))
    }));
    if (s.gallery[0]) { const g = s.gallery[0]; s.photo = { cap: g.cap, by: g.by, src: gUrl(g.f, pickW(g.w || 0, 960)), page: g.page }; }
  });

  /* ---------- État ---------- */
  const DZ_BOUNDS = [[18.9, -8.7], [37.2, 12.0]];
  const inDZ = (la, lo) => la >= DZ_BOUNDS[0][0] && la <= DZ_BOUNDS[1][0] && lo >= DZ_BOUNDS[0][1] && lo <= DZ_BOUNDS[1][1];

  let reports = (store.get(KEYS.reports, []) || []).filter(r => r && r.id && TYPES[r.type] && GRAV[r.gravite] && typeof r.wilaya === 'string' && isFinite(r.lat) && isFinite(r.lng));
  let favs = (store.get(KEYS.favs, []) || []).filter(id => siteById(id));
  const filters = { cat: 'tous', query: '', favOnly: false };

  /* ---------- Navigation ---------- */
  function initNav() {
    const header = $('#header'), toggle = $('#navToggle'), menu = $('#navMenu');
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

    const setMenu = open => {
      menu.classList.toggle('open', open);
      toggle.classList.toggle('active', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    };
    toggle.addEventListener('click', e => { e.stopPropagation(); setMenu(!menu.classList.contains('open')); });
    $$('a', menu).forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('click', e => { if (!menu.contains(e.target) && !toggle.contains(e.target)) setMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

    // Lien actif selon la section visible
    const owner = { destinations: 'accueil', mission: 'accueil', 'apercu-stats': 'accueil' };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => entries.forEach(en => {
        if (!en.isIntersecting) return;
        const id = owner[en.target.id] || en.target.id;
        $$('.nav-link').forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + id));
      }), { rootMargin: '-45% 0px -50% 0px' });
      $$('main section[id]').forEach(s => io.observe(s));
    }
    $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  }

  /* ---------- Animations (apparition, compteurs) ---------- */
  function animateCounter(el) {
    const target = Number(el.dataset.target) || 0;
    if (reduceMotion) { el.textContent = target.toLocaleString('fr-FR'); return; }
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / 1800, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString('fr-FR');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function initReveal() {
    if (!('IntersectionObserver' in window)) { $$('.reveal').forEach(e => e.classList.add('visible')); $$('.counter').forEach(animateCounter); return; }
    const io = new IntersectionObserver(list => list.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
    }), { threshold: 0.12 });
    $$('.reveal').forEach(e => io.observe(e));
    const co = new IntersectionObserver(list => list.forEach(en => {
      if (en.isIntersecting) { setTimeout(() => animateCounter(en.target), 900); co.unobserve(en.target); }
    }), { threshold: 0.5 });
    $$('.counter').forEach(c => co.observe(c));
  }

  /* ---------- Favoris ---------- */
  const isFav = id => favs.includes(id);
  function toggleFav(id) {
    const s = siteById(id); if (!s) return;
    const next = isFav(id) ? favs.filter(f => f !== id) : [...favs, id];
    if (!store.set(KEYS.favs, next)) { toast('Impossible d’enregistrer vos favoris : le stockage local est indisponible.', 'error'); return; }
    favs = next;
    toast(isFav(id) ? `« ${s.nom} » ajouté à vos favoris.` : `« ${s.nom} » retiré de vos favoris.`, 'success');
    updateFavUI();
    if (filters.favOnly) renderNature();
  }
  function updateFavUI() {
    $('#favCount').textContent = favs.length;
    $('#prevFavs').textContent = favs.length;
    $$('.fav-btn[data-id]').forEach(b => {
      const on = isFav(b.dataset.id);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Retirer des favoris' : 'Ajouter aux favoris');
      b.textContent = on ? '❤' : '♡';
    });
    $$('.popup-btn[data-act="fav"]').forEach(b => { b.textContent = isFav(b.dataset.id) ? '❤ Favori' : '♡ Ajouter'; });
    $$('[data-modal-fav]').forEach(b => { b.textContent = isFav(b.dataset.modalFav) ? 'Retirer des favoris' : 'Ajouter aux favoris'; });
  }

  /* ---------- Découvrir la nature ---------- */
  function mediaHTML(s) {
    return `<span class="ph" aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;font-size:4rem;opacity:.55">${CATS[s.cat].icon}</span>` +
      (s.photo ? `<img src="${esc(s.photo.src)}" alt="${esc(s.photo.cap)}" loading="lazy" decoding="async"><div class="photo-info"><span class="photo-caption">${esc(s.photo.cap)}</span><span class="photo-credit">${creditHTML(s.photo)}</span></div>` : '');
  }
  function renderNature() {
    const q = norm(filters.query);
    const list = SITES.filter(s =>
      (filters.cat === 'tous' || s.cat === filters.cat) &&
      (!filters.favOnly || isFav(s.id)) &&
      (!q || norm(`${s.nom} ${s.wilaya} ${s.desc} ${CATS[s.cat].label}`).includes(q)));
    const grid = $('#natureGrid'), empty = $('#natureEmpty');
    grid.innerHTML = list.map(s => `
      <article class="nature-card fade-in">
        <div class="card-media">${mediaHTML(s)}
          <span class="tag tag-${s.cat}">${CATS[s.cat].label}</span>
          <button type="button" class="fav-btn" data-id="${s.id}" aria-pressed="false"></button>
        </div>
        <div class="card-body">
          <h3>${esc(s.nom)}</h3>
          <p class="meta">📍 ${esc(s.wilaya)}</p>
          <p>${esc(firstSentence(s.desc))}</p>
          <div class="card-actions">
            <button type="button" class="btn btn-small btn-outline" data-act="details" data-id="${s.id}">Détails</button>
            <button type="button" class="btn btn-small btn-outline" data-act="map" data-id="${s.id}">Sur la carte</button>
          </div>
        </div>
      </article>`).join('');
    empty.hidden = list.length > 0;
    empty.textContent = filters.favOnly && !favs.length
      ? 'Vous n’avez pas encore de favori. Cliquez sur le cœur d’un site pour l’ajouter.'
      : 'Aucun site ne correspond à votre recherche. Essayez un autre mot-clé ou une autre catégorie.';
    updateFavUI();
  }
  function initNature() {
    $$('#natureFilters .chip').forEach(chip => chip.addEventListener('click', () => {
      $$('#natureFilters .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filters.cat = chip.dataset.filter;
      renderNature();
    }));
    let timer;
    $('#searchInput').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { filters.query = e.target.value; renderNature(); }, 150); });
    $('#favFilter').addEventListener('click', e => {
      filters.favOnly = !filters.favOnly;
      e.currentTarget.setAttribute('aria-pressed', String(filters.favOnly));
      renderNature();
    });
    $('#natureGrid').addEventListener('click', e => {
      const fav = e.target.closest('.fav-btn');
      if (fav) return toggleFav(fav.dataset.id);
      const b = e.target.closest('[data-act]'); if (!b) return;
      b.dataset.act === 'details' ? openModal(b.dataset.id) : showSite(b.dataset.id);
    });
    $$('.card-link[data-site]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openModal(a.dataset.site); }));
  }

  /* ---------- Fenêtre de détails ---------- */
  let lastFocus = null;
  function openModal(id) {
    const s = siteById(id); if (!s) return;
    lastFocus = document.activeElement;
    $('#modalContent').innerHTML = `
      ${s.gallery && s.gallery.length ? galleryHTML(s) : (s.photo ? `<img src="${esc(s.photo.src)}" alt="${esc(s.photo.cap)}">` : '')}
      <div class="modal-body">
        <h3 id="modalTitle">${esc(s.nom)}</h3>
        <p class="meta">${CATS[s.cat].icon} ${CATS[s.cat].label} · ${esc(s.wilaya)}</p>
        <p>${esc(s.desc)}</p>
        ${s.photo && !(s.gallery && s.gallery.length) ? `<p class="hint">📷 ${esc(s.photo.cap)} · ${creditHTML(s.photo)}</p>` : ''}
        ${commonsNote(s)}
        <ul>
          <li>Wilaya : ${esc(s.wilaya)}</li>
          <li>Catégorie : ${CATS[s.cat].label}</li>
          <li>Position approximative : ${s.lat.toFixed(2)}° N, ${s.lng.toFixed(2)}° ${s.lng < 0 ? 'O' : 'E'}</li>
        </ul>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" data-modal-fav="${s.id}"></button>
          <button type="button" class="btn btn-outline" data-modal-map="${s.id}">Voir sur la carte</button>
        </div>
      </div>`;
    $('#modal').hidden = false;
    $('.modal-dialog').classList.toggle('modal-large', !!(s.gallery && s.gallery.length));
    $('.modal-dialog').scrollTop = 0;
    initGallery(s);
    document.body.style.overflow = 'hidden';
    updateFavUI();
    $('.modal-close').focus();
  }
  function closeModal() {
    if ($('#modal').hidden) return;
    $('#modal').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function initModal() {
    $('#modal').addEventListener('click', e => {
      if (e.target.closest('[data-close-modal]')) return closeModal();
      const f = e.target.closest('[data-modal-fav]'); if (f) return toggleFav(f.dataset.modalFav);
      const m = e.target.closest('[data-modal-map]'); if (m) { closeModal(); showSite(m.dataset.modalMap); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    // Image introuvable : on retire la balise, le dégradé et l’icône restent visibles
    document.addEventListener('error', e => {
      const img = e.target;
      if (img.tagName !== 'IMG' || !img.closest('.card-media, .modal-dialog, .lightbox')) return;
      if (img.src.includes('?width=') && !img.dataset.retry) { img.dataset.retry = '1'; img.src = img.src.split('?')[0]; }
      else if (img.closest('.gallery, .lightbox')) { img.classList.add('img-error'); img.alt = 'Photo momentanément indisponible'; }
      else img.remove();
    }, true);
  }

  /* ---------- Carte interactive ---------- */
  let map, siteGroups = {}, siteMarkers = {}, reportGroup, reportMarkers = {}, pickMap, pickMarker;
  const pin = (cls, emoji) => L.divIcon({ className: '', html: `<div class="marker-pin ${cls}"><span>${emoji}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 36], popupAnchor: [0, -36] });
  const addTiles = m => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
  const wheelGuard = m => { m.scrollWheelZoom.disable(); m.on('click focus', () => m.scrollWheelZoom.enable()); m.on('mouseout', () => m.scrollWheelZoom.disable()); };

  function sitePopup(s) {
    return `<h4>${esc(s.nom)}</h4><p style="margin:0 0 .3rem"><small>${CATS[s.cat].icon} ${CATS[s.cat].label} · ${esc(s.wilaya)}</small></p>
      <p style="margin:0 0 .5rem">${esc(firstSentence(s.desc))}</p>
      <button type="button" class="popup-btn" data-act="details" data-id="${s.id}">Voir la fiche</button>
      <button type="button" class="popup-btn" data-act="fav" data-id="${s.id}">${isFav(s.id) ? '❤ Favori' : '♡ Ajouter'}</button>`;
  }
  function reportPopup(r) {
    return `<h4>${TYPES[r.type].icon} ${TYPES[r.type].label}</h4>
      <p style="margin:0 0 .3rem"><strong>${esc(r.lieu)}</strong><br><small>${esc(r.wilaya)} · ${fmtDate(r.date)} · Gravité ${GRAV[r.gravite].toLowerCase()}</small></p>
      <p style="margin:0">${esc(r.description)}</p>`;
  }
  function initMap() {
    const el = $('#map');
    if (typeof L === 'undefined') {
      const msg = '<p class="empty-state">La carte n’a pas pu être chargée. Vérifiez votre connexion Internet puis actualisez la page.</p>';
      el.innerHTML = msg; $('#reportMap').innerHTML = msg; return;
    }
    map = L.map(el).setView([28.2, 2.6], 5);
    addTiles(map); wheelGuard(map);
    Object.keys(CATS).forEach(c => { siteGroups[c] = L.layerGroup().addTo(map); });
    SITES.forEach(s => {
      const m = L.marker([s.lat, s.lng], { icon: pin(s.cat, CATS[s.cat].icon), title: s.nom }).bindPopup(() => sitePopup(s));
      siteGroups[s.cat].addLayer(m); siteMarkers[s.id] = m;
    });
    reportGroup = L.layerGroup().addTo(map);
    map.on('popupopen', e => {
      const root = e.popup.getElement(); if (!root) return;
      $$('.popup-btn', root).forEach(b => b.addEventListener('click', () => b.dataset.act === 'details' ? openModal(b.dataset.id) : toggleFav(b.dataset.id)));
    });
    $$('.map-layer').forEach(cb => cb.addEventListener('change', () => cb.checked ? siteGroups[cb.value].addTo(map) : map.removeLayer(siteGroups[cb.value])));
    $('#layerReports').addEventListener('change', e => e.target.checked ? reportGroup.addTo(map) : map.removeLayer(reportGroup));
    $('#mapReset').addEventListener('click', () => map.fitBounds(DZ_BOUNDS));
    refreshReportMarkers();
  }
  function refreshReportMarkers() {
    if (!map) return;
    reportGroup.clearLayers(); reportMarkers = {};
    reports.forEach(r => {
      const m = L.marker([r.lat, r.lng], { icon: pin('alerte', TYPES[r.type].icon), title: TYPES[r.type].label }).bindPopup(reportPopup(r));
      reportGroup.addLayer(m); reportMarkers[r.id] = m;
    });
  }
  function goToMap(fn) {
    if (!map) { toast('La carte n’est pas disponible pour le moment.', 'error'); return false; }
    $('#carte').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    map.invalidateSize(); fn(); return true;
  }
  function showSite(id) {
    const s = siteById(id); if (!s) return;
    goToMap(() => {
      const cb = $(`.map-layer[value="${s.cat}"]`);
      if (cb && !cb.checked) { cb.checked = true; siteGroups[s.cat].addTo(map); }
      map.setView([s.lat, s.lng], 9);
      setTimeout(() => siteMarkers[id].openPopup(), 700);
    });
  }
  function showReport(id) {
    const r = reports.find(x => x.id === id); if (!r) return;
    goToMap(() => {
      const cb = $('#layerReports');
      if (!cb.checked) { cb.checked = true; reportGroup.addTo(map); }
      map.setView([r.lat, r.lng], 12);
      setTimeout(() => reportMarkers[id] && reportMarkers[id].openPopup(), 700);
    });
  }

  /* ---------- Formulaire de signalement ---------- */
  const F = { type: $('#rType'), wilaya: $('#rWilaya'), lieu: $('#rLieu'), desc: $('#rDesc'), gravite: $('#rGravite'), date: $('#rDate'), lat: $('#rLat'), lng: $('#rLng') };
  const FIELDS = { rType: ['type'], rWilaya: ['wilaya'], rLieu: ['lieu'], rDesc: ['desc'], rGravite: ['gravite'], rDate: ['date'], rCoords: ['lat', 'lng'] };

  function showErrors(errs) {
    Object.entries(FIELDS).forEach(([key, names]) => {
      const msg = errs[key] || '';
      const out = $(`[data-error-for="${key}"]`); if (out) out.textContent = msg;
      names.forEach(n => {
        F[n].classList.toggle('invalid', !!msg);
        F[n].setAttribute('aria-invalid', msg ? 'true' : 'false');
        const wrap = F[n].closest('.field'); if (wrap) wrap.classList.toggle('invalid', !!msg);
      });
    });
  }
  function validate() {
    const e = {}, v = k => F[k].value.trim();
    if (!TYPES[v('type')]) e.rType = 'Veuillez choisir le type de problème.';
    if (!WILAYAS.includes(v('wilaya'))) e.rWilaya = 'Veuillez choisir une wilaya.';
    if (v('lieu').length < 3) e.rLieu = 'Indiquez un lieu d’au moins 3 caractères.';
    if (v('desc').length < 10) e.rDesc = 'La description doit contenir au moins 10 caractères.';
    if (!GRAV[v('gravite')]) e.rGravite = 'Veuillez choisir un niveau de gravité.';
    const d = v('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) e.rDate = 'Indiquez la date de l’observation.';
    else if (d > today()) e.rDate = 'La date ne peut pas être dans le futur.';
    const la = parseFloat(v('lat')), lo = parseFloat(v('lng'));
    if (isNaN(la) || isNaN(lo)) e.rCoords = 'Cliquez sur la carte, saisissez les coordonnées ou utilisez votre position.';
    else if (!inDZ(la, lo)) e.rCoords = 'Les coordonnées doivent se situer en Algérie.';
    return e;
  }

  function placeMarker(la, lo) {
    if (!pickMap) return;
    if (pickMarker) pickMarker.setLatLng([la, lo]);
    else {
      pickMarker = L.marker([la, lo], { icon: pin('alerte', '📍'), draggable: true }).addTo(pickMap);
      pickMarker.on('dragend', () => { const p = pickMarker.getLatLng(); setPick(p.lat, p.lng); });
    }
  }
  function setPick(la, lo, zoom) {
    F.lat.value = la.toFixed(5); F.lng.value = lo.toFixed(5);
    placeMarker(la, lo);
    if (zoom && pickMap) pickMap.setView([la, lo], zoom);
    showErrors({ ...validateCoordsOnly() });
  }
  function validateCoordsOnly() { // efface l’erreur de coordonnées dès qu’elles sont valides
    const la = parseFloat(F.lat.value), lo = parseFloat(F.lng.value);
    const out = {}; $$('[data-error-for]').forEach(s => { if (s.textContent && s.dataset.errorFor !== 'rCoords') out[s.dataset.errorFor] = s.textContent; });
    if (isNaN(la) || isNaN(lo) || !inDZ(la, lo)) out.rCoords = $('[data-error-for="rCoords"]').textContent;
    return out;
  }

  function initPickMap() {
    if (typeof L === 'undefined') return;
    pickMap = L.map('reportMap').setView([28.2, 2.6], 5);
    addTiles(pickMap); wheelGuard(pickMap);
    pickMap.on('click', e => {
      if (!inDZ(e.latlng.lat, e.latlng.lng)) return toast('Choisissez un point situé en Algérie.', 'error');
      setPick(e.latlng.lat, e.latlng.lng);
    });
  }

  function initForm() {
    // Options « Autre » ajoutées depuis le script (le HTML reste inchangé)
    [$('#rType'), $('#reportFilter')].forEach(sel => {
      if (sel && !$(`option[value="autre"]`, sel)) sel.insertAdjacentHTML('beforeend', sel.id === 'rType' ? '<option value="autre">❓ Autre</option>' : '<option value="autre">Autres</option>');
    });
    F.wilaya.insertAdjacentHTML('beforeend', WILAYAS.map((w, i) => `<option value="${esc(w)}">${String(i + 1).padStart(2, '0')} – ${esc(w)}</option>`).join(''));
    F.date.max = today(); F.date.value = today();

    const form = $('#reportForm');
    // Efface l’erreur d’un champ dès qu’on le modifie
    Object.entries(FIELDS).forEach(([key, names]) => names.forEach(n => {
      F[n].addEventListener('input', () => {
        const out = $(`[data-error-for="${key}"]`); if (out) out.textContent = '';
        F[n].classList.remove('invalid'); F[n].setAttribute('aria-invalid', 'false');
        const w = F[n].closest('.field'); if (w) w.classList.remove('invalid');
      });
    }));
    // Coordonnées saisies à la main : le repère suit
    const follow = () => {
      const la = parseFloat(F.lat.value), lo = parseFloat(F.lng.value);
      if (!isNaN(la) && !isNaN(lo) && inDZ(la, lo)) { placeMarker(la, lo); if (pickMap) pickMap.setView([la, lo], Math.max(pickMap.getZoom(), 9)); }
    };
    F.lat.addEventListener('change', follow); F.lng.addEventListener('change', follow);

    $('#btnLocate').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('La géolocalisation n’est pas disponible sur ce navigateur.', 'error');
      toast('Recherche de votre position…', 'info');
      navigator.geolocation.getCurrentPosition(p => {
        const { latitude: la, longitude: lo } = p.coords;
        if (!inDZ(la, lo)) return toast('Votre position semble hors d’Algérie. Cliquez sur la carte pour choisir le lieu.', 'error');
        setPick(la, lo, 13); toast('Position détectée et placée sur la carte.', 'success');
      }, err => toast(err.code === 1 ? 'Accès à la position refusé. Cliquez sur la carte pour choisir le lieu.' : 'Impossible de déterminer votre position. Cliquez sur la carte pour choisir le lieu.', 'error'),
      { enableHighAccuracy: true, timeout: 10000 });
    });

    form.addEventListener('reset', () => setTimeout(() => {
      showErrors({}); F.date.value = today();
      if (pickMarker && pickMap) { pickMap.removeLayer(pickMarker); pickMarker = null; }
    }, 0));

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      const errs = validate(); showErrors(errs);
      const first = Object.keys(errs)[0];
      if (first) { F[FIELDS[first][0]].focus(); return toast('Le formulaire contient des erreurs. Corrigez les champs signalés en rouge.', 'error'); }
      const report = {
        id: uid(), type: F.type.value, wilaya: F.wilaya.value, lieu: F.lieu.value.trim(), description: F.desc.value.trim(),
        gravite: F.gravite.value, date: F.date.value, lat: +parseFloat(F.lat.value).toFixed(5), lng: +parseFloat(F.lng.value).toFixed(5),
        createdAt: new Date().toISOString()
      };
      const next = [report, ...reports];
      if (!store.set(KEYS.reports, next)) return toast('Enregistrement impossible : le stockage local du navigateur est indisponible ou plein.', 'error');
      reports = next; form.reset(); refreshAll();
      toast('Signalement enregistré sur cet appareil uniquement. Il n’est pas transmis aux autorités : en cas d’urgence, appelez les secours.', 'success');
    });
  }

  /* ---------- Liste des signalements ---------- */
  function renderReports() {
    const f = $('#reportFilter').value, list = reports.filter(r => f === 'tous' || r.type === f);
    $('#reportCount').textContent = reports.length;
    $('#reportList').innerHTML = list.map(r => `
      <li class="report-item ${r.type}">
        <h4>${TYPES[r.type].icon} ${TYPES[r.type].label} – ${esc(r.lieu)}</h4>
        <div class="report-meta">
          <span class="badge badge-${r.gravite}">Gravité ${GRAV[r.gravite].toLowerCase()}</span>
          <span>📍 ${esc(r.wilaya)}</span><span>📅 ${fmtDate(r.date)}</span>
        </div>
        <p>${esc(r.description)}</p>
        <div class="report-actions">
          <button type="button" class="report-locate" data-id="${r.id}">Voir sur la carte</button>
          <button type="button" class="report-delete" data-id="${r.id}">Supprimer</button>
        </div>
      </li>`).join('');
    const empty = $('#reportEmpty');
    empty.hidden = list.length > 0;
    empty.textContent = reports.length ? 'Aucun signalement de ce type.' : 'Aucun signalement pour le moment. Les signalements sont enregistrés uniquement sur cet appareil.';
  }
  function initReportList() {
    $('#reportFilter').addEventListener('change', renderReports);
    $('#reportList').addEventListener('click', e => {
      const loc = e.target.closest('.report-locate'); if (loc) return showReport(loc.dataset.id);
      const del = e.target.closest('.report-delete'); if (!del) return;
      if (!confirm('Supprimer ce signalement de cet appareil ?')) return;
      const next = reports.filter(r => r.id !== del.dataset.id);
      if (!store.set(KEYS.reports, next)) return toast('Suppression impossible : stockage local indisponible.', 'error');
      reports = next; refreshAll(); toast('Signalement supprimé.', 'success');
    });
  }

  /* ---------- Tableau de bord (données réelles uniquement) ---------- */
  function countBy(key) { return reports.reduce((acc, r) => (acc[r[key]] = (acc[r[key]] || 0) + 1, acc), {}); }
  function drawBars(el, rows) {
    if (!reports.length) { el.innerHTML = '<p class="hint">Aucune donnée : enregistrez un signalement pour alimenter ce graphique.</p>'; return; }
    const max = Math.max(...rows.map(r => r.value), 0);
    el.innerHTML = rows.map(r => `<div class="bar-row"><span class="bar-label">${esc(r.label)}</span><span class="bar-track"><span class="bar-fill ${r.cls || ''}" data-w="${max ? Math.round(r.value / max * 100) : 0}"></span></span><span class="bar-value">${r.value}</span></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.bar-fill', el).forEach(b => { b.style.width = b.dataset.w + '%'; })));
  }
  function renderDashboard() {
    const byType = countBy('type'), byGrav = countBy('gravite'), byWilaya = countBy('wilaya');
    const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
    const tt = top(byType), tw = top(byWilaya);
    $('#kpiTotal').textContent = reports.length;
    $('#kpiHigh').textContent = byGrav.elevee || 0;
    $('#kpiTopType').textContent = tt ? `${TYPES[tt[0]].label} (${tt[1]})` : '–';
    $('#kpiTopWilaya').textContent = tw ? `${tw[0]} (${tw[1]})` : '–';
    drawBars($('#chartType'), Object.keys(TYPES).map(k => ({ label: TYPES[k].label, value: byType[k] || 0, cls: k })));
    drawBars($('#chartGravite'), Object.keys(GRAV).map(k => ({ label: GRAV[k], value: byGrav[k] || 0, cls: k })));
    drawBars($('#chartWilaya'), Object.entries(byWilaya).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, n]) => ({ label: w, value: n })));
  }
  function renderPreview() {
    $('#prevTotal').textContent = reports.length;
    $('#prevUrgent').textContent = reports.filter(r => r.gravite === 'elevee').length;
    $('#prevWilayas').textContent = new Set(reports.map(r => r.wilaya)).size;
    $('#prevFavs').textContent = favs.length;
  }
  function initDashboard() {
    $('#btnExport').addEventListener('click', () => {
      if (!reports.length) return toast('Aucun signalement à exporter pour le moment.', 'info');
      const payload = { application: 'NATURE DZ', exportedAt: new Date().toISOString(), note: 'Données enregistrées localement sur cet appareil.', total: reports.length, reports };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      a.download = `nature-dz-signalements-${today()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Export JSON téléchargé.', 'success');
    });
    $('#btnClear').addEventListener('click', () => {
      if (!reports.length) return toast('Il n’y a aucun signalement à supprimer.', 'info');
      if (!confirm('Supprimer tous les signalements enregistrés sur cet appareil ? Cette action est irréversible.')) return;
      if (!store.set(KEYS.reports, [])) return toast('Réinitialisation impossible : stockage local indisponible.', 'error');
      reports = []; refreshAll(); toast('Tous les signalements ont été supprimés.', 'success');
    });
  }
  function refreshAll() { renderReports(); renderDashboard(); renderPreview(); refreshReportMarkers(); }

  /* ---------- Guide écologique ---------- */
  function initGuide() {
    const triggers = $$('.acc-trigger');
    const setOpen = (btn, open) => { btn.setAttribute('aria-expanded', String(open)); $('#' + btn.getAttribute('aria-controls')).hidden = !open; };
    triggers.forEach(btn => btn.addEventListener('click', () => {
      const wasOpen = btn.getAttribute('aria-expanded') === 'true';
      triggers.forEach(b => setOpen(b, false));
      if (!wasOpen) setOpen(btn, true);
    }));
    if (triggers[0]) setOpen(triggers[0], true);

    const boxes = $$('#checklist input[type="checkbox"]');
    const saved = store.get(KEYS.checklist, []);
    boxes.forEach(b => { b.checked = Array.isArray(saved) && saved.includes(b.dataset.id); });
    const update = () => {
      const n = boxes.filter(b => b.checked).length, pct = Math.round(n / boxes.length * 100);
      $('#progressFill').style.width = pct + '%';
      $('#progressBar').setAttribute('aria-valuenow', pct);
      $('#progressText').textContent = `${n} sur ${boxes.length} ${n > 1 ? 'engagements' : 'engagement'}`;
    };
    const save = () => { if (!store.set(KEYS.checklist, boxes.filter(b => b.checked).map(b => b.dataset.id))) toast('Impossible d’enregistrer vos engagements : stockage local indisponible.', 'error'); };
    boxes.forEach(b => b.addEventListener('change', () => {
      update(); save();
      if (boxes.every(x => x.checked)) toast('Bravo, vous avez adopté tous les engagements !', 'success');
    }));
    $('#btnChecklistReset').addEventListener('click', () => { boxes.forEach(b => { b.checked = false; }); update(); save(); toast('Liste d’engagements réinitialisée.', 'info'); });
    update();
  }

  /* ---------- Galerie photo : image principale, miniatures, agrandissement ---------- */
  let cur = null, lb = null, lbI = 0;
  const galleryCredit = p => `Photo : ${esc(p.by)} · ${p.lic ? esc(p.lic) : 'licence libre'} · <a href="${esc(p.page)}" target="_blank" rel="noopener">Page du fichier sur Wikimedia Commons</a>`;
  function commonsNote(s) {
    const url = `https://commons.wikimedia.org/w/index.php?title=Special:MediaSearch&type=image&search=${encodeURIComponent(s.nom + ' Algérie')}`;
    const few = !s.gallery.length ? 'Aucune photo vérifiée pour le moment. ' : (s.gallery.length < 4 ? 'Galerie en cours d’enrichissement. ' : '');
    return `<p class="hint">🔎 ${few}<a href="${esc(url)}" target="_blank" rel="noopener">Chercher d’autres photos sur Wikimedia Commons</a></p>`;
  }
  function galleryHTML(s) {
    const g = s.gallery, many = g.length > 1;
    return `<div class="gallery" data-site="${s.id}">
      <div class="gallery-stage">
        <img class="gallery-main" src="${esc(g[0].src)}" alt="${esc(g[0].cap)}" decoding="async">
        ${many ? '<button type="button" class="gallery-nav gallery-prev" aria-label="Photo précédente">‹</button><button type="button" class="gallery-nav gallery-next" aria-label="Photo suivante">›</button>' : ''}
        <button type="button" class="gallery-zoom" aria-label="Agrandir la photo">⤢ Agrandir</button>
        <span class="gallery-count"></span>
      </div>
      <div class="gallery-info"><span class="gallery-caption"></span><span class="gallery-credit"></span></div>
      ${many ? `<div class="gallery-thumbs" role="group" aria-label="Miniatures">${g.map((p, i) => `<button type="button" class="gallery-thumb" data-i="${i}" aria-label="Photo ${i + 1} : ${esc(p.cap)}"><img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}
    </div>`;
  }
  function galleryShow(n) {
    const root = $('.gallery'); if (!cur || !root) return;
    const g = cur.s.gallery; cur.i = (n + g.length) % g.length;
    const p = g[cur.i], main = $('.gallery-main', root);
    main.classList.remove('img-error'); delete main.dataset.retry; main.src = p.src; main.alt = p.cap;
    $('.gallery-caption', root).textContent = p.cap;
    $('.gallery-credit', root).innerHTML = galleryCredit(p);
    $('.gallery-count', root).textContent = `${cur.i + 1} / ${g.length}`;
    $$('.gallery-thumb', root).forEach((b, k) => { b.classList.toggle('active', k === cur.i); b.setAttribute('aria-current', String(k === cur.i)); });
    const act = $('.gallery-thumb.active', root);
    if (act) { const bar = act.parentElement; bar.scrollTo({ left: act.offsetLeft - bar.clientWidth / 2 + act.clientWidth / 2, behavior: reduceMotion ? 'auto' : 'smooth' }); }
    [1, -1].forEach(d => { const q = g[(cur.i + d + g.length) % g.length]; new Image().src = q.src; });
  }
  function swipe(el, onLeft, onRight) {
    let x0 = null;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 45) (dx < 0 ? onLeft : onRight)();
    });
  }
  function initGallery(s) {
    const root = $('.gallery'); cur = null; if (!root || !s.gallery.length) return;
    cur = { s, i: 0 }; galleryShow(0);
    root.addEventListener('click', e => {
      if (e.target.closest('.gallery-prev')) return galleryShow(cur.i - 1);
      if (e.target.closest('.gallery-next')) return galleryShow(cur.i + 1);
      const t = e.target.closest('.gallery-thumb'); if (t) return galleryShow(Number(t.dataset.i));
      if (e.target.closest('.gallery-zoom, .gallery-main')) openLightbox(cur.i);
    });
    swipe($('.gallery-stage', root), () => galleryShow(cur.i + 1), () => galleryShow(cur.i - 1));
  }

  function ensureLightbox() {
    if (lb) return lb;
    lb = document.createElement('div');
    lb.className = 'lightbox'; lb.hidden = true;
    lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Photo agrandie');
    lb.innerHTML = `<div class="lightbox-stage"><img class="lightbox-img" alt="">
        <button type="button" class="lightbox-btn lightbox-close" aria-label="Fermer l’agrandissement">&times;</button>
        <button type="button" class="lightbox-btn lightbox-prev" aria-label="Photo précédente">‹</button>
        <button type="button" class="lightbox-btn lightbox-next" aria-label="Photo suivante">›</button></div>
      <div class="lightbox-bar"><span class="lightbox-caption"></span><span class="lightbox-credit"></span><span class="lightbox-count"></span></div>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', e => {
      if (e.target.closest('.lightbox-close') || e.target.classList.contains('lightbox-stage')) return closeLightbox();
      if (e.target.closest('.lightbox-prev')) return lbShow(lbI - 1);
      if (e.target.closest('.lightbox-next')) return lbShow(lbI + 1);
      if (e.target.classList.contains('lightbox-img')) lb.classList.toggle('zoomed');
    });
    swipe($('.lightbox-stage', lb), () => lbShow(lbI + 1), () => lbShow(lbI - 1));
    return lb;
  }
  function lbShow(n) {
    const g = cur.s.gallery; lbI = (n + g.length) % g.length;
    const p = g[lbI], img = $('.lightbox-img', lb);
    lb.classList.remove('zoomed'); img.classList.remove('img-error'); delete img.dataset.retry; img.src = p.big; img.alt = p.cap;
    $('.lightbox-caption', lb).textContent = p.cap;
    $('.lightbox-credit', lb).innerHTML = galleryCredit(p);
    $('.lightbox-count', lb).textContent = `${lbI + 1} / ${g.length}`;
    $$('.lightbox-prev, .lightbox-next', lb).forEach(b => { b.hidden = g.length < 2; });
    if ($('.gallery')) galleryShow(lbI);
  }
  function openLightbox(n) {
    if (!cur) return; ensureLightbox(); lb.hidden = false; lbShow(n);
    document.body.style.overflow = 'hidden'; $('.lightbox-close', lb).focus();
  }
  function closeLightbox() {
    if (!lb || lb.hidden) return;
    lb.hidden = true; lb.classList.remove('zoomed');
    if ($('#modal').hidden) document.body.style.overflow = '';
    const z = $('.gallery-zoom'); if (z) z.focus();
  }
  // Clavier : capturé avant le gestionnaire de la fenêtre pour que Échap ne ferme que l’agrandissement
  window.addEventListener('keydown', e => {
    const k = e.key;
    if (lb && !lb.hidden) {
      if (k === 'Escape') { e.stopImmediatePropagation(); closeLightbox(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); lbShow(lbI - 1); }
      else if (k === 'ArrowRight') { e.preventDefault(); lbShow(lbI + 1); }
      return;
    }
    if (cur && cur.s.gallery.length > 1 && !$('#modal').hidden && $('.gallery') && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      e.preventDefault(); galleryShow(cur.i + (k === 'ArrowRight' ? 1 : -1));
    }
  }, true);

  /* ---------- Démarrage ---------- */
  function init() {
    initNav(); initReveal(); initNature(); initModal(); initForm(); initReportList(); initDashboard(); initGuide();
    initMap(); initPickMap();
    renderNature(); refreshAll();
    window.addEventListener('load', () => { if (map) map.invalidateSize(); if (pickMap) pickMap.invalidateSize(); });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
