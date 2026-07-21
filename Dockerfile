FROM nginx:alpine
COPY index.html index.css index.js /usr/share/nginx/html/
EXPOSE 80
