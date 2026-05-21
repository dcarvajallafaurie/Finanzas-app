import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// Nuevas importaciones de Firestore
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

const authPanel = document.getElementById("auth-panel");
const dashboardPanel = document.getElementById("dashboard-panel");
const modalForm = document.getElementById("modal-form");
const formTitle = document.getElementById("form-title");
const formFields = document.getElementById("form-fields");
const btnSubmitForm = document.getElementById("btnSubmitForm");
const btnDeleteForm = document.getElementById("btnDeleteForm");

let budgets = [];
let transactions = [];
let wealth = [];
let activeFormType = null; 
let editingId = null;

const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense"
    },
    wealth: ["Acciones", "Finca Raíz", "Criptomonedas", "Vehículos", "Ahorro Bancario", "Efectivo"]
};

function formatMoney(amount) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount); }

// Login y Auth
onAuthStateChanged(auth, (user) => {
    if (user) {
        authPanel.style.display = "none";
        dashboardPanel.style.display = "flex";
        document.getElementById("user-display").textContent = user.email.split('@')[0];
        cargarDatosNube(); // <-- INICIA LA ESCUCHA DE LA NUBE
        window.showView('home'); 
    } else {
        authPanel.style.display = "block";
        dashboardPanel.style.display = "none";
    }
});

document.getElementById("btnRegister").addEventListener("click", async () => {
    try { await createUserWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert(e.message); }
});
document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Datos incorrectos"); }
});
document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

// --- LECTURA EN TIEMPO REAL DESDE FIRESTORE ---
function cargarDatosNube() {
    // Escucha Movimientos
    onSnapshot(collection(db, "transactions"), (snapshot) => {
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.createdAt - a.createdAt);
        actualizarDatosUI();
    });
    // Escucha Presupuestos
    onSnapshot(collection(db, "budgets"), (snapshot) => {
        budgets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        actualizarDatosUI();
    });
    // Escucha Patrimonio
    onSnapshot(collection(db, "wealth"), (snapshot) => {
        wealth = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        actualizarDatosUI();
    });
}

window.showView = (viewName) => {
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    
    const navItems = { 'home': 0, 'budgets': 1, 'wealth': 2 };
    document.querySelectorAll('.nav-item')[navItems[viewName]].classList.add('active');
    actualizarDatosUI();
};

function actualizarDatosUI() {
    const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    
    document.getElementById("total-income").textContent = `+${formatMoney(income)}`;
    document.getElementById("total-expense").textContent = `-${formatMoney(expense)}`;
    document.getElementById("total-balance").textContent = formatMoney(income - expense);
    document.getElementById("total-wealth-value").textContent = formatMoney(wealth.reduce((sum, w) => sum + w.amount, 0));

    renderList(transactions, document.getElementById("transaction-list"), 'transaction');
    renderList(budgets, document.getElementById("budget-list"), 'budget');
    renderList(wealth, document.getElementById("wealth-list"), 'wealth');
    lucide.createIcons();
}

function renderList(data, container, type) {
    container.innerHTML = data.length ? '' : `<p style="text-align:center; color:#6a7c82; font-size:14px;">No hay registros aún.</p>`;
    data.forEach(item => {
        let valClass = type === 'transaction' ? (item.type === 'income' ? 'val-income' : 'val-expense') : '';
        let prefix = type === 'transaction' ? (item.type === 'income' ? '+' : '-') : '';
        let iconName = type === 'wealth' ? 'landmark' : (type === 'budget' ? 'target' : (item.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'));

        container.innerHTML += `
            <div class="item-card" onclick="openEditForm('${type}', '${item.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${iconName}"></i></div>
                    <div class="item-info">
                        <h5>${item.category || item.name}</h5>
                        <p>${item.description || 'Detalle'}</p>
                    </div>
                </div>
                <div class="${valClass}">${prefix}${formatMoney(item.amount)}</div>
            </div>
        `;
    });
}

window.toggleForm = (type = null) => {
    activeFormType = type;
    editingId = null; 
    btnDeleteForm.style.display = 'none';

    if (!type) return modalForm.classList.remove('active');
    
    modalForm.classList.add('active');
    formTitle.textContent = "Añadir Nuevo";
    
    if (type === 'budget') {
        formFields.innerHTML = `${generarSelect(CATEGORIES.budget)}<input type="number" id="f-amount" class="glass-input" placeholder="Monto asignado">`;
    } else if (type === 'transaction') {
        formFields.innerHTML = `${generarSelect(Object.keys(CATEGORIES.transaction))}<input type="number" id="f-amount" class="glass-input" placeholder="Valor ($)"><input type="text" id="f-desc" class="glass-input" placeholder="Descripción (Ej. Uber)">`;
    } else if (type === 'wealth') {
        formFields.innerHTML = `${generarSelect(CATEGORIES.wealth)}<input type="text" id="f-desc" class="glass-input" placeholder="Nombre (Ej. Apartamento)"><input type="number" id="f-amount" class="glass-input" placeholder="Valor actual ($)">`;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id;
    formTitle.textContent = "Editar / Ver Detalle";
    btnDeleteForm.style.display = 'block';

    let item = (type === 'transaction' ? transactions : (type === 'budget' ? budgets : wealth)).find(i => i.id === id);
    
    document.getElementById("f-cat").value = item.category;
    document.getElementById("f-amount").value = item.amount;
    if(document.getElementById("f-desc")) document.getElementById("f-desc").value = item.description || item.name || "";
};

function generarSelect(options) {
    return `<select id="f-cat" class="glass-input"><option value="" disabled selected>Selecciona Categoría</option>${options.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`;
}

// --- ESCRITURA HACIA FIRESTORE ---
btnSubmitForm.addEventListener("click", async () => {
    if (!activeFormType) return;
    
    const cat = document.getElementById("f-cat").value;
    const amount = parseFloat(document.getElementById("f-amount").value);
    const desc = document.getElementById("f-desc") ? document.getElementById("f-desc").value : "";
    if (!cat || !amount) return alert("Llena los datos requeridos.");

    // Botón en modo carga
    btnSubmitForm.textContent = "Guardando...";
    btnSubmitForm.disabled = true;

    let dataToSave = { category: cat, amount: amount, createdAt: Date.now() };

    if (activeFormType === 'transaction') {
        dataToSave.type = CATEGORIES.transaction[cat]; 
        dataToSave.description = desc;
    } else if (activeFormType === 'wealth') {
        dataToSave.name = desc;
    }

    const collectionName = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : 'wealth');
    const collectionRef = collection(db, collectionName);

    try {
        if (editingId) {
            await updateDoc(doc(db, collectionName, editingId), dataToSave);
        } else {
            await addDoc(collectionRef, dataToSave);
        }
        window.toggleForm();
    } catch (error) {
        alert("Error de conexión: " + error.message);
    } finally {
        btnSubmitForm.textContent = "Guardar";
        btnSubmitForm.disabled = false;
    }
});

// --- ELIMINAR DE FIRESTORE ---
btnDeleteForm.addEventListener("click", async () => {
    if (!editingId) return;
    const collectionName = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : 'wealth');
    try {
        await deleteDoc(doc(db, collectionName, editingId));
        window.toggleForm();
    } catch (error) {
        alert("Error al eliminar: " + error.message);
    }
});