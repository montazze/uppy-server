function list ({ query, params, session, uppyProvider }, res, next) {
  const providerName = params.providerName
  const token = session[providerName].token

  const provider = uppyProvider

  provider.list({ token, directory: params.id, query }, (err, resp, body) => {
    if (err) {
      return next(err)
    }
    return res.json(body)
  })
}

exports = module.exports = list
