import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

let budgets = [], transactions = [], wealth = [], creditCards = [], ccTransactions = [], customCategories = [];
let activeFormType = null, editingId = null, currentUser = null;
let currentMonth = new Date().toISOString().slice(0, 7); 
let systemTRM = 4000.00; 
let myChart = null;
let compareChart = null;

const chartColors = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#06b6d4', '#f97316'];

const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense",
        "Emergencia": "expense", "Pago Tarjeta": "expense"
    },
    wealthIcons: [
        { name: "Fondo de Emergencia", icon: "shield" }, { name: "CDT", icon: "lock" }, { name: "Ahorro", icon: "piggy-bank" },
        { name: "Activo", icon: "briefcase" }
    ]
};

export function formatCurrency(value, currency = "COP") {
    const numericValue = Number(value) || 0;
    const decimalCount = (numericValue % 1 === 0) ? 0 : 2;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: decimalCount, maximumFractionDigits: 2 }).format(numericValue);
}

function formatearFechaConHora(timestamp) {
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

async function sincronizarTRM() {
    document.getElementById("trm-display").textContent = "Sincronizando...";
    try {
        const respuesta = await fetch('https://open.er-api.com/v6/latest/USD');
        const datos = await respuesta.json();
        if (datos && datos.rates && datos.rates.COP) { systemTRM = parseFloat(datos.rates.COP); }
    } catch (error) { console.log("Fallo TRM"); }
    document.getElementById("trm-display").textContent = formatCurrency(systemTRM, "COP");
    if (currentUser) actualizarDatosUI();
}
window.forzarActualizacionTRM = async () => await sincronizarTRM();

document.getElementById("full-date-display").textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
sincronizarTRM();

document.getElementById("month-selector").value = currentMonth;
document.getElementById("month-selector").addEventListener("change", (e) => { currentMonth = e.target.value; actualizarDatosUI(); });
document.getElementById("sort-transactions").addEventListener("change", actualizarDatosUI);
document.getElementById("btnThemeToggle").addEventListener("click", () => document.body.classList.toggle("light-mode"));

// --- AUTH ---
let captchaCorrectAnswer = 0;
document.getElementById("btnRegister").addEventListener("click", () => {
    document.getElementById("btnLogin").style.display = "none";
    document.getElementById("btnRegister").style.display = "none";
    document.getElementById("btnSubmitRegister").style.display = "block";
    document.getElementById("btnBackToLogin").style.display = "block";
    document.getElementById("register-fields").style.display = "block";
    document.getElementById("captcha-container").style.display = "block";
    let n1 = Math.floor(Math.random() * 9) + 1, n2 = Math.floor(Math.random() * 9) + 1;
    captchaCorrectAnswer = n1 + n2;
    document.getElementById("captcha-question").textContent = `${n1} + ${n2} =`;
});

document.getElementById("btnBackToLogin").addEventListener("click", () => window.location.reload());

document.getElementById("btnSubmitRegister").addEventListener("click", async () => {
    const nombre = document.getElementById("nombre").value.trim(), apellido = document.getElementById("apellido").value.trim();
    const email = document.getElementById("email").value.trim(), password = document.getElementById("password").value.trim();
    if (!nombre || !email || !password) return alert("Completa los campos.");
    if (parseInt(document.getElementById("captcha-answer").value) !== captchaCorrectAnswer) return alert("Anti-bot incorrecto.");
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: `${nombre} ${apellido}` });
        await addDoc(collection(db, "creditCards"), { userId: cred.user.uid, limit: 3000000.00, cutOffDate: 15, paymentDate: 1, handlingFee: 0, createdAt: Date.now() });
    } catch (e) { alert("Error: " + e.message); }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Credenciales incorrectas."); }
});
document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-panel").style.display = "none";
        document.getElementById("dashboard-panel").style.display = "block";
        document.getElementById("user-display").textContent = `EVA | ${user.displayName ? user.displayName.split(' ')[0] : ''}`;
        cargarFlujosDeDatosFirebase();
        window.showView('home'); 
    } else {
        currentUser = null;
        document.getElementById("auth-panel").style.display = "block";
        document.getElementById("dashboard-panel").style.display = "none";
    }
});

function cargarFlujosDeDatosFirebase() {
    const q = (col) => query(collection(db, col), where("userId", "==", currentUser.uid));
    onSnapshot(q("categories"), snap => { customCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderizarVistaGestionCategorias(); actualizarDatosUI(); });
    onSnapshot(q("transactions"), snap => { transactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("budgets"), snap => { budgets = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("wealth"), snap => { wealth = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("creditCards"), snap => { creditCards = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("ccTransactions"), snap => { ccTransactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
}

window.showView = (vista) => {
    document.querySelectorAll('.view-container, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${vista}`).classList.add('active');
    const indice = {'home': 0, 'budgets': 1, 'credit': 2, 'wealth': 3, 'categories': 4};
    if(indice[vista] !== undefined && indice[vista] < 4) document.querySelectorAll('.nav-item')[indice[vista]].classList.add('active');
    actualizarDatosUI();
};

window.toggleBudgetDetails = (id) => {
    const div = document.getElementById(`budget-details-${id}`);
    if(div) div.style.display = (div.style.display === 'none' || div.style.display === '') ? 'flex' : 'none';
};

// --- RENDER UI ---
function actualizarDatosUI() {
    if (!currentUser) return;
    const resolverMontoCOP = (item) => item.baseCurrency === "USD" ? (item.amount * systemTRM) : (item.convertedAmount || item.amount);

    const txMes = transactions.filter(t => t.month === currentMonth);
    let incMes = txMes.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0);
    const expMes = txMes.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    
    const txPasadas = transactions.filter(t => t.month < currentMonth);
    const rollover = txPasadas.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0) - txPasadas.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    
    if (rollover > 0) {
        incMes += rollover;
        document.getElementById("rollover-indicator").textContent = `Saldo (+${formatCurrency(rollover)} remanente)`;
    } else { document.getElementById("rollover-indicator").textContent = "Saldo Total Disponible"; }

    document.getElementById("total-income").textContent = `+${formatCurrency(incMes)}`;
    document.getElementById("total-expense").textContent = `-${formatCurrency(expMes)}`;
    document.getElementById("total-balance").textContent = formatCurrency(incMes - expMes);

    // ORDENAMIENTO Y LISTA
    const sortVal = document.getElementById("sort-transactions").value;
    txMes.sort((a, b) => {
        if(sortVal === "date-desc") return b.createdAt - a.createdAt;
        if(sortVal === "date-asc") return a.createdAt - b.createdAt;
        if(sortVal === "amount-desc") return resolverMontoCOP(b) - resolverMontoCOP(a);
        if(sortVal === "amount-asc") return resolverMontoCOP(a) - resolverMontoCOP(b);
    });

    const cTrans = document.getElementById("transaction-list");
    cTrans.innerHTML = '';
    txMes.forEach(t => {
        let isInc = t.type === 'income';
        cTrans.innerHTML += `
            <div class="item-card" onclick="window.openEditForm('transaction', '${t.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div>
                    <div class="item-info"><h5>${t.category}</h5><p>${t.description || 'Sin detalle'} • ${formatearFechaConHora(t.createdAt)}</p></div>
                </div>
                <div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatCurrency(resolverMontoCOP(t))}</div>
            </div>`;
    });

    const cBudg = document.getElementById("budget-list");
    cBudg.innerHTML = budgets.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:14px; margin-top:20px;">Sin presupuestos.</p>`;
    budgets.forEach(b => {
        const gasEfectivo = txMes.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0);
        const gasTC = ccTransactions.filter(t => t.month === currentMonth && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0); 
        const acumulado = gasEfectivo + gasTC;
        let pct = Math.min((acumulado / b.amount) * 100, 100);
        let color = pct >= 90 ? 'danger' : (pct >= 70 ? 'warning' : '');
        let restante = b.amount - acumulado;

        cBudg.innerHTML += `
            <div class="item-card budget-card" onclick="window.toggleBudgetDetails('${b.id}')">
                <div class="budget-header"><div class="item-left"><div class="item-icon"><i data-lucide="target"></i></div><div class="item-info"><h5 style="margin:0; font-size:16px;">${b.category}</h5></div></div><div style="text-align: right;"><span style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">Restante</span><span style="font-weight:700; font-size:16px; color: ${restante < 0 ? 'var(--expense-color)' : 'var(--text-main)'};">${formatCurrency(restante)}</span></div></div>
                <div class="budget-progress-container"><div class="budget-progress-fill ${color}" style="width: ${pct}%;"></div></div>
                <div id="budget-details-${b.id}" class="budget-details"><div class="budget-stats"><span>Consumido: <b>${formatCurrency(acumulado)}</b></span><span style="text-align:right;">Límite: <b>${formatCurrency(b.amount)}</b></span></div><button class="glass-btn secondary" style="padding:10px; font-size:14px; margin-top: 5px;" onclick="event.stopPropagation(); window.openEditForm('budget', '${b.id}')">Editar</button></div>
            </div>`;
    });

    document.getElementById("total-wealth-value").textContent = formatCurrency(wealth.reduce((s, w) => s + resolverMontoCOP(w), 0));
    const cWealth = document.getElementById("wealth-list");
    cWealth.innerHTML = '';
    wealth.forEach(w => {
        cWealth.innerHTML += `<div class="item-card" onclick="window.openEditForm('wealth', '${w.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${w.icon || 'briefcase'}"></i></div><div class="item-info"><h5>${w.name}</h5></div></div><div style="font-weight:600;">${formatCurrency(resolverMontoCOP(w))}</div></div>`;
    });

    // TARJETA DE CRÉDITO REAL
    if (creditCards.length > 0) {
        let metaTC = creditCards[0];
        document.getElementById("cc-cut").textContent = metaTC.cutOffDate || "15";
        document.getElementById("cc-pay").textContent = metaTC.paymentDate || "1";
        document.getElementById("cc-fee").textContent = formatCurrency(metaTC.handlingFee || 0);

        let feeMes = metaTC.handlingFee || 0;
        
        let deudaGenerada = ccTransactions.reduce((s, t) => s + (t.totalDebt || t.amount), 0) + feeMes;
        let abonos = transactions.filter(t => t.category === "Pago Tarjeta").reduce((s, t) => s + resolverMontoCOP(t), 0);
        let deudaVigente = Math.max(0, deudaGenerada - abonos);
        
        // CUPO LIBRE resta solo el 'amount' base original
        let capitalConsumidoBruto = ccTransactions.reduce((s, t) => s + t.amount, 0); 
        let cupoLibre = Math.max(0, metaTC.limit - (capitalConsumidoBruto - abonos));

        document.getElementById("cc-debt").textContent = formatCurrency(deudaVigente);
        document.getElementById("cc-available").textContent = formatCurrency(cupoLibre);
        
        const ccList = document.getElementById("cc-transactions-list");
        ccList.innerHTML = ccTransactions.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:12px; padding:10px;">Sin consumos.</p>`;
        
        ccTransactions.filter(t => t.month === currentMonth).forEach(t => {
            // Diseño explícito para mostrar la alerta de intereses debajo
            let cuotasInfo = t.cuotas > 1 ? `<br><span style="color:var(--expense-color); font-weight:bold; font-size:11px; display:inline-block; margin-top:4px;">↳ ${t.cuotas} Cuotas. Total final con intereses: ${formatCurrency(t.totalDebt)}</span>` : '';
            
            // El valor principal a la derecha es el que se resta del cupo
            ccList.innerHTML += `
                <div class="item-card" onclick="window.openEditForm('cc-transaction', '${t.id}')">
                    <div class="item-left">
                        <div class="item-icon"><i data-lucide="shopping-bag"></i></div>
                        <div class="item-info">
                            <h5>${t.category}</h5>
                            <p style="line-height:1.4;">${t.description || 'Compra'} • ${formatearFechaConHora(t.createdAt)}${cuotasInfo}</p>
                        </div>
                    </div>
                    <div class="val-expense" style="font-size:16px;">-${formatCurrency(t.amount)}</div>
                </div>`;
        });
    }
    lucide.createIcons();
}

window.openFilteredTransactionsModal = (type) => {
    document.getElementById("modal-filtered-transactions").classList.add('active');
    document.getElementById("filtered-transactions-title").textContent = type === 'income' ? 'Ingresos' : 'Egresos';
    const tx = transactions.filter(t => t.month === currentMonth && t.type === type);
    const c = document.getElementById("filtered-transactions-list");
    c.innerHTML = tx.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:14px; margin-top:20px;">Vacío.</p>`;
    tx.sort((a,b)=>b.createdAt - a.createdAt).forEach(t => {
        let isInc = t.type === 'income';
        c.innerHTML += `<div class="item-card" onclick="window.openEditForm('transaction', '${t.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description} • ${formatearFechaConHora(t.createdAt)}</p></div></div><div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatCurrency(t.amount)}</div></div>`;
    });
    lucide.createIcons();
}
window.closeFilteredTransactionsModal = () => document.getElementById("modal-filtered-transactions").classList.remove('active');

// --- CATEGORÍAS PURAS ---
function renderizarVistaGestionCategorias() {
    const contenedor = document.getElementById("custom-categories-management-list");
    if (!contenedor) return;
    contenedor.innerHTML = customCategories.length ? '' : '<p style="text-align:center; color:var(--text-muted); font-size:13px;">Sin categorías propias.</p>';
    customCategories.forEach(c => {
        contenedor.innerHTML += `
            <div class="item-card"><div class="item-left"><div class="item-icon"><i data-lucide="tag"></i></div><div class="item-info"><h5>${c.name}</h5><p>${c.type === 'income' ? 'Ingreso' : 'Egreso'}</p></div></div>
            <div><button onclick="window.eliminarCategoriaExclusiva('${c.id}')" class="icon-btn" style="color:var(--expense-color); border:none;"><i data-lucide="trash-2" style="width:16px;"></i></button></div></div>`;
    });
    lucide.createIcons();
}

window.eliminarCategoriaExclusiva = async (id) => {
    if(confirm("¿Eliminar categoría?")) { try { await deleteDoc(doc(db, "categories", id)); } catch(e) { alert("Error al remover"); } }
};

function obtenerOpcionesCategoriasHTML() {
    let opciones = [...Object.keys(CATEGORIES.transaction)];
    customCategories.forEach(c => { if(!opciones.includes(c.name)) opciones.push(c.name); });
    return opciones.map(c => `<option value="${c}">${c}</option>`).join('');
}

window.toggleForm = (tipo = null) => {
    activeFormType = tipo;
    editingId = null;
    document.getElementById("btnDeleteForm").style.display = 'none';
    if (!tipo) return document.getElementById("modal-form").classList.remove('active');
    
    document.getElementById("modal-form").classList.add('active');
    const f = document.getElementById("form-fields"), t = document.getElementById("form-title");
    
    if (tipo === 'transaction') {
        t.textContent = "Nuevo Movimiento";
        f.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML()}</select><select id="f-currency" class="glass-input"><option value="COP" selected>Pesos (COP)</option><option value="USD">Dólares (USD)</option></select><input type="number" id="f-amount" class="glass-input" placeholder="Importe Neto"><textarea id="f-desc" class="glass-input" placeholder="Detalles"></textarea>`;
    } else if (tipo === 'custom-category') {
        t.textContent = "Crear Categoría Propia";
        f.innerHTML = `<input type="text" id="f-cat-name" class="glass-input" placeholder="Nombre (Ej. Mascotas, Subscripción)"><select id="f-cat-type" class="glass-input"><option value="expense" selected>Es Egreso/Gasto</option><option value="income">Es Ingreso</option></select>`;
    } else if (tipo === 'wealth') {
        t.textContent = "Añadir Activo";
        f.innerHTML = `<select id="f-type" class="glass-input">${CATEGORIES.wealthIcons.map(w => `<option value="${w.name}|${w.icon}">${w.name}</option>`).join('')}</select><select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select><input type="text" id="f-desc" class="glass-input" placeholder="Nombre (Banco)"><input type="number" id="f-amount" class="glass-input" placeholder="Saldo">`;
    } else if (tipo === 'budget') {
        t.textContent = "Presupuesto";
        f.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría a limitar</option>${obtenerOpcionesCategoriasHTML()}</select><input type="number" id="f-amount" class="glass-input" placeholder="Límite Máximo">`;
    } else if (tipo === 'cc-transaction') {
        t.textContent = "Compra con Tarjeta";
        f.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML()}</select><select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select><input type="number" id="f-amount" class="glass-input" placeholder="Costo base (Principal)"><input type="number" id="f-cuotas" class="glass-input" placeholder="Cuotas" value="1" min="1"><textarea id="f-desc" class="glass-input" placeholder="Detalle"></textarea>`;
    } else if (tipo === 'edit-cc-limit') {
        t.textContent = "Configurar Tarjeta";
        let c = creditCards.length > 0 ? creditCards[0] : {limit: 3000000, cutOffDate: 15, paymentDate: 1, handlingFee: 0};
        f.innerHTML = `<input type="number" id="f-amount" class="glass-input" placeholder="Cupo Total Máximo" value="${c.limit}"><div style="display:flex;gap:10px;"><input type="number" id="f-cut" class="glass-input" placeholder="Día Corte (1-31)" value="${c.cutOffDate||15}"><input type="number" id="f-pay" class="glass-input" placeholder="Día Pago" value="${c.paymentDate||1}"></div><input type="number" id="f-fee" class="glass-input" placeholder="Cuota de Manejo ($)" value="${c.handlingFee||0}">`;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id; document.getElementById("btnDeleteForm").style.display = 'block';
    let item = (type==='wealth'?wealth:(type==='transaction'?transactions:(type==='cc-transaction'?ccTransactions:budgets))).find(i=>i.id===id);
    if (item) {
        if (type === 'wealth') { document.getElementById("f-type").value = `${item.name}|${item.icon}`; document.getElementById("f-amount").value = item.amount; document.getElementById("f-desc").value = item.description || ""; } 
        else { document.getElementById("f-cat").value = item.category; document.getElementById("f-amount").value = item.amount; if (document.getElementById("f-desc")) document.getElementById("f-desc").value = item.description || ""; }
    }
};

document.getElementById("btnSubmitForm").addEventListener("click", async () => {
    if (!activeFormType) return;
    const btn = document.getElementById("btnSubmitForm"); btn.disabled = true;

    try {
        if (activeFormType === 'custom-category') {
            const nom = document.getElementById("f-cat-name").value.trim(), tip = document.getElementById("f-cat-type").value;
            if(!nom) throw new Error("Especifica nombre.");
            if(customCategories.some(c=>c.name.toLowerCase()===nom.toLowerCase()) || Object.keys(CATEGORIES.transaction).some(c=>c.toLowerCase()===nom.toLowerCase())) throw new Error("Categoría ya existe.");
            await addDoc(collection(db, "categories"), { userId: currentUser.uid, name: nom, type: tip, createdAt: Date.now() });
            window.toggleForm(); btn.disabled = false; return;
        }

        const fAmount = document.getElementById("f-amount");
        if (fAmount && !fAmount.value) throw new Error("Monto requerido.");

        let p = { userId: currentUser.uid, createdAt: Date.now() };
        let imp = fAmount ? parseFloat(fAmount.value) : 0;
        let div = document.getElementById("f-currency") ? document.getElementById("f-currency").value : "COP";
        p.amount = imp; p.baseCurrency = div; p.exchangeRate = systemTRM; p.convertedAmount = div==="USD"?(imp*systemTRM):imp;

        if (activeFormType === 'edit-cc-limit') {
            let config = { limit: imp, cutOffDate: parseInt(document.getElementById("f-cut").value), paymentDate: parseInt(document.getElementById("f-pay").value), handlingFee: parseFloat(document.getElementById("f-fee").value) };
            if (creditCards.length > 0) await updateDoc(doc(db, "creditCards", creditCards[0].id), config);
            else await addDoc(collection(db, "creditCards"), { userId: currentUser.uid, ...config, createdAt: Date.now() });
        } else if (activeFormType === 'wealth') {
            const [n, i] = document.getElementById("f-type").value.split('|'); p = { ...p, name:n, icon:i, description: document.getElementById("f-desc").value };
            if(editingId) await updateDoc(doc(db, "wealth", editingId), p); else await addDoc(collection(db, "wealth"), p);
        } else if (activeFormType === 'transaction') {
            const cat = document.getElementById("f-cat").value;
            let tipD = CATEGORIES.transaction[cat]; if (!tipD) tipD = customCategories.find(c=>c.name===cat)?.type || "expense";
            p = { ...p, category: cat, type: tipD, description: document.getElementById("f-desc").value, month: currentMonth };
            if (cat === "Emergencia") { let fo = wealth.find(w=>w.name==="Fondo de Emergencia"); if(fo) await updateDoc(doc(db, "wealth", fo.id), {amount: Math.max(0, fo.amount-(div==="USD"?imp:(imp/systemTRM)))}); }
            if(editingId) await updateDoc(doc(db, "transactions", editingId), p); else await addDoc(collection(db, "transactions"), p);
        } else if (activeFormType === 'cc-transaction') {
            const ctas = parseInt(document.getElementById("f-cuotas").value) || 1;
            let dProy = p.convertedAmount;
            if (ctas > 1) { const tM = Math.pow(1.2817, 1/12)-1; dProy = ((p.convertedAmount*tM*Math.pow(1+tM,ctas))/(Math.pow(1+tM,ctas)-1))*ctas; }
            p = { ...p, category: document.getElementById("f-cat").value, cuotas: ctas, totalDebt: dProy, description: document.getElementById("f-desc").value, month: currentMonth };
            if(editingId) await updateDoc(doc(db, "ccTransactions", editingId), p); else await addDoc(collection(db, "ccTransactions"), p);
        } else if (activeFormType === 'budget') {
            const dBd = { userId: currentUser.uid, category: document.getElementById("f-cat").value, amount: imp, createdAt: Date.now() };
            if(editingId) await updateDoc(doc(db, "budgets", editingId), dBd); else await addDoc(collection(db, "budgets"), dBd);
        }
        window.toggleForm();
    } catch (err) { alert(err.message); } finally { btn.disabled = false; }
});

document.getElementById("btnDeleteForm").addEventListener("click", async () => {
    if (!editingId) return;
    let col = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : (activeFormType === 'wealth' ? 'wealth' : 'ccTransactions'));
    try { await deleteDoc(doc(db, col, editingId)); window.toggleForm(); window.closeFilteredTransactionsModal(); } catch (e) { alert("Error eliminando"); }
});

// --- EXPORTAR EXCEL CSV ---
window.exportarAExcel = () => {
    let csvContent = "data:text/csv;charset=utf-8,Fecha,Tipo,Categoría,Descripción,Importe COP\n";
    transactions.filter(t => t.month === currentMonth).forEach(t => {
        let val = t.baseCurrency==="USD"?(t.amount*systemTRM):(t.convertedAmount||t.amount);
        csvContent += `${formatearFechaConHora(t.createdAt)},${t.type==='income'?'Ingreso':'Egreso'},${t.category},${t.description||''},${val}\n`;
    });
    ccTransactions.filter(t => t.month === currentMonth).forEach(t => {
        csvContent += `${formatearFechaConHora(t.createdAt)},Crédito,${t.category},${t.description||''},${t.amount}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Reporte_EVA_${currentMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- GRÁFICOS (DOBLE CANVAS PARA COMPARATIVA) ---
window.openChartModal = () => {
    document.getElementById("modal-chart").classList.add('active');
    const ctxDoughnut = document.getElementById('monthlyChart').getContext('2d');
    const ctxBar = document.getElementById('comparisonChart').getContext('2d');
    
    // Mes Actual
    let expCatMes = {}; let totalExpMes = 0;
    const resolverMontoCOP = (i) => i.baseCurrency==="USD"?(i.amount*systemTRM):(i.convertedAmount||i.amount);
    
    transactions.filter(t => t.type==='expense' && t.month===currentMonth).forEach(t => { let v=resolverMontoCOP(t); expCatMes[t.category]=(expCatMes[t.category]||0)+v; totalExpMes+=v; });
    ccTransactions.filter(t => t.month===currentMonth).forEach(t => { let v=resolverMontoCOP(t); expCatMes[t.category]=(expCatMes[t.category]||0)+v; totalExpMes+=v; });

    // Mes Anterior (Para comparativa)
    let [y, m] = currentMonth.split('-');
    let datePrev = new Date(y, parseInt(m)-2, 1);
    let prevMonthStr = `${datePrev.getFullYear()}-${String(datePrev.getMonth()+1).padStart(2,'0')}`;
    
    let expCatPrev = {};
    transactions.filter(t => t.type==='expense' && t.month===prevMonthStr).forEach(t => { expCatPrev[t.category]=(expCatPrev[t.category]||0)+resolverMontoCOP(t); });
    ccTransactions.filter(t => t.month===prevMonthStr).forEach(t => { expCatPrev[t.category]=(expCatPrev[t.category]||0)+resolverMontoCOP(t); });

    document.getElementById("chart-total-expense").textContent = formatCurrency(totalExpMes);
    const leg = document.getElementById("custom-legend"); leg.innerHTML = '';
    
    // Configurar Leyenda y Donut Chart
    Object.keys(expCatMes).forEach((cat, idx) => {
        let p = totalExpMes > 0 ? Math.round((expCatMes[cat]/totalExpMes)*100) : 0;
        leg.innerHTML += `<div class="legend-item"><div style="display:flex; align-items:center; font-size:14px; font-weight:500;"><span class="legend-color-box" style="background:${chartColors[idx%chartColors.length]}"></span>${cat}</div><div><span style="font-weight:700;">${formatCurrency(expCatMes[cat])}</span><span style="font-size:12px; color:var(--text-muted); margin-left:6px;">${p}%</span></div></div>`;
    });

    if (myChart) myChart.destroy();
    myChart = new Chart(ctxDoughnut, { type: 'doughnut', data: { labels: Object.keys(expCatMes), datasets: [{ data: Object.values(expCatMes), backgroundColor: chartColors, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue('--glass-bg').trim() }] }, options: { cutout: '78%', plugins: { legend: { display: false } } } });

    // Configurar Bar Chart (Comparativa Top 3)
    let topCats = Object.keys(expCatMes).sort((a,b)=>expCatMes[b]-expCatMes[a]).slice(0,3);
    let dataCurrent = topCats.map(c => expCatMes[c] || 0);
    let dataPrev = topCats.map(c => expCatPrev[c] || 0);

    if(compareChart) compareChart.destroy();
    compareChart = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: topCats,
            datasets: [
                { label: 'Mes Pasado', data: dataPrev, backgroundColor: '#71717a' },
                { label: 'Mes Actual', data: dataCurrent, backgroundColor: '#3b82f6' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position:'bottom', labels:{color:'#f8fafc'} } }, scales: { x: { ticks: {color:'#a1a1aa'}}, y:{display:false} } }
    });
};

window.closeChartModal = () => document.getElementById("modal-chart").classList.remove('active');
window.addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay')) { e.target.classList.remove('active'); window.closeChartModal(); } });