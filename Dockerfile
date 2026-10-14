# 1. faza: Java Runtime okolje
FROM eclipse-temurin:17-jre AS java-runtime

# 2. faza: Glavna Python aplikacija
FROM python:3.11-slim

# Kopiramo JRE neposredno iz uradne JRE slike (brez apt-get repozitorijev!)
ENV JAVA_HOME=/opt/java/openjdk
COPY --from=java-runtime $JAVA_HOME $JAVA_HOME
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

# Kopiranje requirements in namestitev python paketov
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Namestitev orodij za prenos (curl)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Kopiranje kode aplikacije
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Kopiranje Mustang-CLI.jar če obstaja lokalno ali prenos uradne izdaje
COPY Mustang-CLI.ja[r] .
RUN if [ ! -f Mustang-CLI.jar ]; then \
        curl -fSL -o Mustang-CLI.jar https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.26.0/Mustang-CLI-2.26.0.jar; \
    fi

# Ustvarjanje map za shrambo
RUN mkdir -p uploads outputs

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
