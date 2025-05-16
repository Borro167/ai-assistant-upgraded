from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
import requests
from io import BytesIO
from fpdf import FPDF
import os

app = Flask(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

def download_openai_file(file_id):
    """Scarica un file caricato su OpenAI dato un file_id"""
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    url = f"https://api.openai.com/v1/files/{file_id}/content"
    res = requests.get(url, headers=headers)
    if res.status_code != 200:
        print("Errore recupero file OpenAI:", res.text)
        raise Exception("Errore nel recupero file OpenAI")
    return BytesIO(res.content)

def best_fit_model(x, y):
    from sklearn.linear_model import LinearRegression
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.metrics import r2_score

    models = {}

    # Lineare
    lin = LinearRegression().fit(x.reshape(-1,1), y)
    r2_lin = r2_score(y, lin.predict(x.reshape(-1,1)))
    models['lineare'] = (r2_lin, lin.coef_.tolist(), lin.intercept_)

    # Polinomiale (grado 2)
    poly = PolynomialFeatures(degree=2)
    x_poly = poly.fit_transform(x.reshape(-1,1))
    poly_reg = LinearRegression().fit(x_poly, y)
    r2_poly = r2_score(y, poly_reg.predict(x_poly))
    models['polinomiale'] = (r2_poly, poly_reg.coef_.tolist(), poly_reg.intercept_)

    # Logaritmico
    x_log = np.log(x[x > 0])
    y_log = y[x > 0]
    if len(x_log) > 1:
        log_reg = LinearRegression().fit(x_log.reshape(-1,1), y_log)
        r2_log = r2_score(y_log, log_reg.predict(x_log.reshape(-1,1)))
        models['logaritmico'] = (r2_log, log_reg.coef_.tolist(), log_reg.intercept_)
    
    best = max(models.items(), key=lambda i: i[1][0])
    return best[0], best[1][0], best[1][1], best[1][2]

def generate_pdf(model, coeffs, r2, intercept):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, txt="Risultati della Regressione", ln=True, align="C")
    pdf.ln(10)
    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"Modello: {model}\nCoefficiente/i: {coeffs}\nIntercetta: {intercept}\nR²: {r2:.4f}")
    output = "/tmp/output.pdf"
    pdf.output(output)
    return output

@app.route("/analizza_file_regressione", methods=["POST"])
def analizza_file_regressione():
    data = request.get_json()
    file_id = data.get("file_id")

    if not file_id:
        return jsonify({"errore": "Manca il parametro file_id!"}), 400

    print("[Render] Ricevuto file_id:", file_id)

    # Scarica il file da OpenAI
    try:
        file_stream = download_openai_file(file_id)
    except Exception as e:
        return jsonify({"errore": "Impossibile scaricare file da OpenAI.", "dettaglio": str(e)}), 400

    # Prova a leggere CSV dal file
    try:
        df = pd.read_csv(file_stream)
    except Exception as e:
        return jsonify({"errore": "Errore nel parsing CSV", "dettaglio": str(e)}), 400

    if df.shape[1] < 2:
        return jsonify({"errore": "Il file deve avere almeno 2 colonne."}), 400

    x = df.iloc[:, 0].values
    y = df.iloc[:, 1].values

    model, r2, coeffs, intercept = best_fit_model(x, y)
    path = generate_pdf(model, coeffs, r2, intercept)

    return jsonify({
        "model": model,
        "coeffs": coeffs,
        "intercept": intercept,
        "r2": r2,
        "pdf_path": path
    })

@app.route("/stima", methods=["POST"])
def stima():
    data = request.get_json()
    modello = data["modello"]
    coeffs = data["coeffs"]
    x = data["x"]

    y = 0
    if modello == "lineare":
        y = coeffs[0] * x + data.get("intercept", 0)
    elif modello == "polinomiale":
        y = sum(c * (x ** i) for i, c in enumerate(coeffs))
    elif modello == "logaritmico":
        y = coeffs[0] * np.log(x) + data.get("intercept", 0)
    else:
        return jsonify({"errore": "Modello non riconosciuto"}), 400

    return jsonify({"x": x, "y": y})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
