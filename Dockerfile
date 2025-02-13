FROM node:20

WORKDIR /usr/../app

COPY package*.json ./

COPY . .
RUN npm ci
RUN npm run build

ENV PORT=4010
ENV TZ=Asia/Kolkata
EXPOSE 4010

CMD [ "npm", "start" ]