import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

// --- VARIABLES GLOBALES Y ESTADO ---
let budgets = [], transactions = [], wealth = [], creditCards = [], ccTransactions = [];
let activeFormType = null, editingId = null, currentUser = null;
let currentMonth = new Date().toISOString().slice(0, 7); 
let TRM = 3900; 
let myChart = null;

const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud", "Otras categorías"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense", "Otras categorías": "expense",
        "Emergencia": "expense", 
        "Pago Tarjeta": "expense" 
    },
    wealthIcons: [
        { name: "Fondo de Emergencia", icon: "shield" },
        { name: "CDT", icon: "lock" },
        { name: "Ahorro Programado", icon: "piggy-bank" },
        { name: "Finca Raíz", icon: "home" },
        { name: "Acciones / Inversión", icon: "trending-up" },
        { name: "Otro Activo", icon: "briefcase" }
    ]
};

// --- INICIALIZACIÓN ---
document.getElementById("month-selector").value = currentMonth;
document.getElementById("month-selector").addEventListener("change", (e) => {
    currentMonth = e.target.value;
    actualizarDatosUI();
});

fetch('https://open.er-api.com/v6/latest/USD').then(res => res.json()).then(data => {
    TRM = data.rates.COP;
    document.getElementById("trm-display").textContent = `$${TRM.toFixed(0)} COP`;
}).catch(e => console.log("Error TRM"));

document.getElementById("btnThemeToggle").addEventListener("click", () => document.body.classList.toggle("light-mode"));

function formatMoney(amount) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount); }

// --- AUTH ---
let captchaCorrect = 0;
document.getElementById("btnRegister").addEventListener("click", () => {
    document.getElementById("btnLogin").style.display = "none";
    document.getElementById("btnRegister").style.display = "none";
    document.getElementById("btnSubmitRegister").style.display = "block";
    document.getElementById("btnBackToLogin").style.display = "block";
    document.getElementById("register-fields").style.display = "block";
    document.getElementById("captcha-container").style.display = "block";
    let n1 = Math.floor(Math.random()*10)+1, n2 = Math.floor(Math.random()*10)+1;
    captchaCorrect = n1 + n2;
    document.getElementById("captcha-question").textContent = `${n1} + ${n2} =`;
});
document.getElementById("btnBackToLogin").addEventListener("click", () => window.location.reload());

document.getElementById("btnSubmitRegister").addEventListener("click", async () => {
    const nombre = document.getElementById("nombre").value, apellido = document.getElementById("apellido").value;
    const email = document.getElementById("email").value, password = document.getElementById("password").value;
    if (parseInt(document.getElementById("captcha-answer").value) !== captchaCorrect) return alert("Captcha incorrecto");
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: `${nombre} ${apellido}` });
        // Cupo inicial por defecto (el usuario lo puede editar luego)
        await addDoc(collection(db, "creditCards"), { userId: cred.user.uid, limit: 2000000, createdAt: Date.now() });
    } catch (e) { alert(e.message); }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Datos incorrectos"); }
});
document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-panel").style.display = "none";
        document.getElementById("dashboard-panel").style.display = "flex";
        document.getElementById("user-display").textContent = user.displayName || user.email.split('@')[0];
        cargarDatos();
        window.showView('home'); 
    } else {
        currentUser = null;
        document.getElementById("auth-panel").style.display = "block";
        document.getElementById("dashboard-panel").style.display = "none";
    }
});

// --- LECTURA BASE DE DATOS ---
function cargarDatos() {
    const q = (col) => query(collection(db, col), where("userId", "==", currentUser.uid));
    onSnapshot(q("transactions"), snap => { transactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("budgets"), snap => { budgets = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("wealth"), snap => { wealth = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("creditCards"), snap => { creditCards = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("ccTransactions"), snap => { ccTransactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
}

window.showView = (v) => {
    document.querySelectorAll('.view-container, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${v}`).classList.add('active');
    const idx = {'home':0, 'budgets':1, 'credit':2, 'wealth':3};
    document.querySelectorAll('.nav-item')[idx[v]].classList.add('active');
    actualizarDatosUI();
};

// --- RENDERIZADO ---
function actualizarDatosUI() {
    const currentMonthTrans = transactions.filter(t => t.month === currentMonth);
    let incMonth = currentMonthTrans.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expMonth = currentMonthTrans.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
    const pastTrans = transactions.filter(t => t.month < currentMonth);
    const rollover = pastTrans.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) - pastTrans.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    
    if (rollover > 0) {
        incMonth += rollover; 
        document.getElementById("rollover-indicator").textContent = `Saldo Disponible (+${formatMoney(rollover)} del mes pasado)`;
    } else {
        document.getElementById("rollover-indicator").textContent = "Saldo Total Disponible";
    }

    document.getElementById("total-income").textContent = `+${formatMoney(incMonth)}`;
    document.getElementById("total-expense").textContent = `-${formatMoney(expMonth)}`;
    document.getElementById("total-balance").textContent = formatMoney(incMonth - expMonth);

    const cList = document.getElementById("transaction-list");
    cList.innerHTML = '';
    currentMonthTrans.sort((a,b)=>b.createdAt - a.createdAt).forEach(t => {
        let isInc = t.type === 'income';
        cList.innerHTML += `<div class="item-card" onclick="openEditForm('transaction', '${t.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description}</p></div></div><div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatMoney(t.amount)}</div></div>`;
    });

    const bList = document.getElementById("budget-list");
    bList.innerHTML = '';
    budgets.forEach(b => {
        const spent = currentMonthTrans.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
        let pct = Math.min((spent / b.amount) * 100, 100);
        let color = pct >= 90 ? 'danger' : (pct >= 70 ? 'warning' : '');
        bList.innerHTML += `<div class="item-card budget-card" onclick="openEditForm('budget', '${b.id}')"><div class="budget-header"><div class="item-left"><div class="item-icon"><i data-lucide="target"></i></div><div class="item-info"><h5>${b.category}</h5></div></div><div style="font-weight:600;">Límite: ${formatMoney(b.amount)}</div></div><div class="budget-progress-container"><div class="budget-progress-fill ${color}" style="width: ${pct}%;"></div></div><div class="budget-stats"><span>Gastado: ${formatMoney(spent)}</span><span>Restante: ${formatMoney(b.amount - spent)}</span></div></div>`;
    });

    document.getElementById("total-wealth-value").textContent = formatMoney(wealth.reduce((s, w) => s + w.amount, 0));
    const wList = document.getElementById("wealth-list");
    wList.innerHTML = '';
    wealth.forEach(w => {
        wList.innerHTML += `<div class="item-card" onclick="openEditForm('wealth', '${w.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${w.icon}"></i></div><div class="item-info"><h5>${w.name}</h5></div></div><div style="font-weight:600;">${formatMoney(w.amount)}</div></div>`;
    });

    // --- LÓGICA INTELIGENTE DE TARJETA DE CRÉDITO ---
    if(creditCards.length > 0) {
        let cc = creditCards[0];
        
        // Sumamos toda la deuda histórica (con intereses calculados)
        let totalCCDebtGenerated = ccTransactions.reduce((s,t) => s + (t.totalDebt || t.amount), 0);
        // Sumamos todos los pagos históricos a la tarjeta
        let totalCCPayments = transactions.filter(t => t.category === "Pago Tarjeta").reduce((s,t) => s + t.amount, 0);
        
        // La deuda actual es lo que se gastó menos lo que se pagó (nunca menor a 0)
        let currentDebt = Math.max(0, totalCCDebtGenerated - totalCCPayments);
        
        document.getElementById("cc-debt").textContent = formatMoney(currentDebt);
        document.getElementById("cc-available").textContent = formatMoney(cc.limit - currentDebt);
        
        const ccList = document.getElementById("cc-transactions-list");
        ccList.innerHTML = '';
        ccTransactions.filter(t=> t.month === currentMonth).forEach(t => {
            let cuotasInfo = t.cuotas > 1 ? `<span style="color:#ef4444; font-weight:bold;">(${t.cuotas} cuotas - Total pagado será: ${formatMoney(t.totalDebt)})</span>` : '';
            ccList.innerHTML += `<div class="item-card" onclick="openEditForm('cc-transaction', '${t.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="shopping-bag"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description} ${cuotasInfo}</p></div></div><div class="val-expense">-${formatMoney(t.amount)}</div></div>`;
        });
    }
    lucide.createIcons();
}

window.openFilteredTransactionsModal = (type) => {
    document.getElementById("modal-filtered-transactions").classList.add('active');
    document.getElementById("filtered-transactions-title").textContent = type === 'income' ? 'Ingresos' : 'Egresos';
    const currentMonthTrans = transactions.filter(t => t.month === currentMonth && t.type === type);
    const container = document.getElementById("filtered-transactions-list");
    container.innerHTML = currentMonthTrans.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">No hay movimientos este mes.</p>`;
    currentMonthTrans.sort((a,b)=>b.createdAt - a.createdAt).forEach(t => {
        let isInc = t.type === 'income';
        container.innerHTML += `<div class="item-card" onclick="openEditForm('transaction', '${t.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description}</p></div></div><div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatMoney(t.amount)}</div></div>`;
    });
    lucide.createIcons();
}

window.closeFilteredTransactionsModal = () => document.getElementById("modal-filtered-transactions").classList.remove('active');
document.getElementById("income-summary").addEventListener("click", () => window.openFilteredTransactionsModal('income'));
document.getElementById("expense-summary").addEventListener("click", () => window.openFilteredTransactionsModal('expense'));

// --- FORMULARIOS ---
window.toggleForm = (type = null) => {
    activeFormType = type;
    editingId = null;
    document.getElementById("btnDeleteForm").style.display = 'none';

    if (!type) return document.getElementById("modal-form").classList.remove('active');
    
    document.getElementById("modal-form").classList.add('active');
    const fields = document.getElementById("form-fields");
    
    if (type === 'transaction') {
        fields.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${Object.keys(CATEGORIES.transaction).map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Valor ($)"><textarea id="f-desc" class="glass-input" placeholder="Descripción detallada"></textarea>`;
    } else if (type === 'wealth') {
        fields.innerHTML = `<select id="f-type" class="glass-input"><option value="" disabled selected>Tipo</option>${CATEGORIES.wealthIcons.map(w=>`<option value="${w.name}|${w.icon}">${w.name}</option>`).join('')}</select><input type="text" id="f-desc" class="glass-input" placeholder="Nombre"><div style="display:flex; gap:10px;"><input type="number" id="f-amount" class="glass-input" placeholder="Monto"><div style="margin-top:15px; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="f-usd"> <label style="font-size:12px;">Es USD</label></div></div>`;
    } else if (type === 'budget') {
        fields.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${CATEGORIES.budget.map(c=>`<option value="${c}">${c}</option>`).join('')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Límite Mensual ($)">`;
    } else if (type === 'cc-transaction') {
        fields.innerHTML = `
            <select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría de Gasto</option>${CATEGORIES.budget.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
            <input type="number" id="f-amount" class="glass-input" placeholder="Valor de la compra ($)">
            <input type="number" id="f-cuotas" class="glass-input" placeholder="Número de cuotas (Ej: 1)" value="1" min="1">
            <textarea id="f-desc" class="glass-input" placeholder="Descripción detallada"></textarea>
            <p style="font-size:11px; opacity:0.7; margin-top:10px;">A 1 cuota: 0% interés. A más cuotas: 28.17% EA.</p>
        `;
    } else if (type === 'edit-cc-limit') {
        document.getElementById("form-title").textContent = "Ajustar Tarjeta";
        let actualLimit = creditCards.length > 0 ? creditCards[0].limit : 0;
        fields.innerHTML = `
            <p style="font-size:12px; margin-bottom:10px;">Define el cupo total máximo de tu tarjeta.</p>
            <input type="number" id="f-amount" class="glass-input" placeholder="Cupo Total ($)" value="${actualLimit}">
        `;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id; 
    document.getElementById("btnDeleteForm").style.display = 'block'; 
    
    let item;
    if (type === 'wealth') item = wealth.find(i => i.id === id);
    else if (type === 'transaction') item = transactions.find(i => i.id === id);
    else if (type === 'cc-transaction') item = ccTransactions.find(i => i.id === id);
    else if (type === 'budget') item = budgets.find(i => i.id === id);

    if (item) {
        if (type === 'wealth') {
            document.getElementById("f-type").value = `${item.name}|${item.icon}`;
            document.getElementById("f-amount").value = item.amount;
            document.getElementById("f-desc").value = item.description || "";
        } else {
            document.getElementById("f-cat").value = item.category;
            document.getElementById("f-amount").value = item.amount;
            if (document.getElementById("f-desc")) document.getElementById("f-desc").value = item.description || "";
        }
    }
};

// --- GUARDAR ---
document.getElementById("btnSubmitForm").addEventListener("click", async () => {
    if (!activeFormType) return;
    
    const fCat = document.getElementById("f-cat");
    const fAmount = document.getElementById("f-amount");
    const fType = document.getElementById("f-type");

    if ((fCat && !fCat.value) || (fType && !fType.value) || (fAmount && !fAmount.value)) {
        alert("Por favor, llena los campos requeridos.");
        return;
    }

    const btn = document.getElementById("btnSubmitForm");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
        let data = { userId: currentUser.uid, createdAt: Date.now() };

        if (activeFormType === 'edit-cc-limit') {
            if (creditCards.length > 0) {
                await updateDoc(doc(db, "creditCards", creditCards[0].id), { limit: parseFloat(fAmount.value) });
            } else {
                await addDoc(collection(db, "creditCards"), { userId: currentUser.uid, limit: parseFloat(fAmount.value), createdAt: Date.now() });
            }
        } else if (activeFormType === 'wealth') {